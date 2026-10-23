/*
 * gnosh GTK 3 module: starts the gnosh runtime (GJS) inside Phosh.
 *
 * Phosh is started with GTK_MODULES=<path to this file> (set by a systemd
 * user drop-in that `gnosh shell enable` writes). In any program other than
 * phosh the module does nothing.
 *
 * The module deliberately has no link-time dependencies (it is built with
 * -nostdlib): every symbol it uses comes from GLib/GModule, which Phosh has
 * already loaded, so one binary per CPU architecture works on both glibc and
 * musl systems. libgjs is opened at runtime.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

typedef int gboolean;
typedef char gchar;
typedef unsigned int guint;
typedef int gint;
typedef unsigned char guint8;
typedef void *gpointer;
typedef unsigned long gsize;
typedef long gssize;
typedef unsigned int GQuark;
typedef struct { GQuark domain; gint code; gchar *message; } GError;
typedef struct _GModule GModule;
typedef struct _GjsContext GjsContext;
typedef gboolean (*GSourceFunc) (gpointer data);

#define TRUE 1
#define FALSE 0
#define NULL ((void *) 0)
#define G_LOG_LEVEL_WARNING (1 << 4)
#define G_LOG_LEVEL_MESSAGE (1 << 5)
#define G_MODULE_BIND_LAZY  (1 << 0)
#define G_MODULE_BIND_LOCAL (1 << 1)
#define G_FILE_TEST_EXISTS  (1 << 4)

extern const gchar *g_get_prgname (void);
extern const gchar *g_getenv (const gchar *variable);
extern const gchar *g_get_user_data_dir (void);
extern const gchar *g_get_user_config_dir (void);
extern const gchar *g_get_user_runtime_dir (void);
extern gchar *g_build_filename (const gchar *first_element, ...);
extern gchar *g_path_get_basename (const gchar *file_name);
extern gchar *g_filename_to_uri (const gchar *filename, const gchar *hostname, GError **error);
extern gboolean g_file_test (const gchar *filename, int test);
extern gboolean g_file_get_contents (const gchar *filename, gchar **contents, gsize *length, GError **error);
extern gboolean g_file_set_contents (const gchar *filename, const gchar *contents, gssize length, GError **error);
extern gint g_mkdir_with_parents (const gchar *pathname, gint mode);
extern gint g_strcmp0 (const char *str1, const char *str2);
extern long long g_ascii_strtoll (const gchar *nptr, gchar **endptr, guint base);
extern gchar *g_strdup_printf (const gchar *format, ...);
extern void g_free (gpointer mem);
extern void g_clear_error (GError **err);
extern void g_log (const gchar *log_domain, int log_level, const gchar *format, ...);
extern guint g_idle_add (GSourceFunc function, gpointer data);
extern GModule *g_module_open (const gchar *file_name, int flags);
extern gboolean g_module_symbol (GModule *module, const gchar *symbol_name, gpointer *symbol);
extern const gchar *g_module_error (void);

#define LOG_DOMAIN "gnosh"
/* After this many starts that never became stable, stay inactive until the
 * runtime directory is cleared (logout/reboot) or `gnosh shell reset` runs. */
#define MAX_UNSTABLE_STARTS 2

typedef GjsContext *(*GjsContextNewFunc) (void);
typedef gboolean (*GjsEvalModuleFileFunc) (GjsContext *, const char *, guint8 *, GError **);
typedef gboolean (*GjsRegisterModuleFunc) (GjsContext *, const char *, const char *, GError **);
typedef gboolean (*GjsEvalModuleFunc) (GjsContext *, const char *, guint8 *, GError **);

static gchar *main_module;
static GjsContext *gjs_context;

static gboolean
is_phosh (gint *argc, gchar ***argv)
{
  const gchar *prgname = g_get_prgname ();
  gboolean ret = FALSE;

  if (prgname && g_strcmp0 (prgname, "phosh") == 0)
    return TRUE;

  if (argc && *argc > 0 && argv && *argv && (*argv)[0]) {
    gchar *base = g_path_get_basename ((*argv)[0]);
    ret = g_strcmp0 (base, "phosh") == 0;
    g_free (base);
  }
  return ret;
}

/* Count starts that have not (yet) been marked stable by the runtime. The
 * runtime deletes the counter file once it has been up for a while, so a
 * crash loop caused by gnosh falls back to stock Phosh instead of ending the
 * session (mobi.phosh.Shell.service allows only 3 failures in 15 s). */
static gboolean
crash_guard_allows_start (void)
{
  const gchar *runtime_dir = g_get_user_runtime_dir ();
  gchar *dir = g_build_filename (runtime_dir, "gnosh", NULL);
  gchar *counter = g_build_filename (dir, "unstable-starts", NULL);
  gchar *contents = NULL, *str;
  long long count = 0;
  gboolean allow;

  g_mkdir_with_parents (dir, 0700);
  if (g_file_get_contents (counter, &contents, NULL, NULL) && contents)
    count = g_ascii_strtoll (contents, NULL, 10);
  g_free (contents);

  allow = count < MAX_UNSTABLE_STARTS;
  if (allow) {
    str = g_strdup_printf ("%lld\n", count + 1);
    g_file_set_contents (counter, str, -1, NULL);
    g_free (str);
  } else {
    gchar *marker = g_build_filename (dir, "safe-mode", NULL);
    g_file_set_contents (marker, "crash-loop\n", -1, NULL);
    g_free (marker);
    g_log (LOG_DOMAIN, G_LOG_LEVEL_WARNING,
           "gnosh did not start: Phosh restarted %lld times before gnosh became "
           "stable. Running stock Phosh. Run 'gnosh shell reset' to retry.", count);
  }

  g_free (counter);
  g_free (dir);
  return allow;
}

static gboolean
boot (gpointer data)
{
  GModule *gjs;
  GjsContextNewFunc context_new = NULL;
  GjsEvalModuleFileFunc eval_module_file = NULL;
  GjsRegisterModuleFunc register_module = NULL;
  GjsEvalModuleFunc eval_module = NULL;
  GError *error = NULL;
  guint8 status = 0;
  gboolean ok;

  (void) data;

  gjs = g_module_open ("libgjs.so.0", G_MODULE_BIND_LAZY | G_MODULE_BIND_LOCAL);
  if (!gjs) {
    g_log (LOG_DOMAIN, G_LOG_LEVEL_WARNING, "Cannot load libgjs: %s", g_module_error ());
    return FALSE;
  }

  if (!g_module_symbol (gjs, "gjs_context_new", (gpointer *) &context_new) || !context_new) {
    g_log (LOG_DOMAIN, G_LOG_LEVEL_WARNING, "libgjs lacks gjs_context_new");
    return FALSE;
  }
  g_module_symbol (gjs, "gjs_context_eval_module_file", (gpointer *) &eval_module_file);
  g_module_symbol (gjs, "gjs_context_register_module", (gpointer *) &register_module);
  g_module_symbol (gjs, "gjs_context_eval_module", (gpointer *) &eval_module);

  gjs_context = context_new ();
  g_log (LOG_DOMAIN, G_LOG_LEVEL_MESSAGE, "Starting gnosh runtime %s", main_module);

  if (eval_module_file) {
    ok = eval_module_file (gjs_context, main_module, &status, &error);
  } else if (register_module && eval_module) {
    gchar *uri = g_filename_to_uri (main_module, NULL, &error);

    ok = uri && register_module (gjs_context, "gnosh-main", uri, &error) &&
      eval_module (gjs_context, "gnosh-main", &status, &error);
    g_free (uri);
  } else {
    g_log (LOG_DOMAIN, G_LOG_LEVEL_WARNING, "libgjs is too old (needs ESM support)");
    return FALSE;
  }

  if (!ok)
    g_log (LOG_DOMAIN, G_LOG_LEVEL_WARNING, "gnosh runtime failed: %s",
           error ? error->message : "unknown error");
  g_clear_error (&error);

  /* The context stays alive for the lifetime of Phosh. */
  return FALSE;
}

/* Called by GTK when the module is loaded. */
__attribute__ ((visibility ("default"))) void gtk_module_init (gint *argc, gchar ***argv);

void
gtk_module_init (gint *argc, gchar ***argv)
{
  const gchar *env;
  gchar *disabled;

  if (!is_phosh (argc, argv))
    return;

  if (g_getenv ("GNOSH_DISABLE")) {
    g_log (LOG_DOMAIN, G_LOG_LEVEL_MESSAGE, "Disabled by GNOSH_DISABLE");
    return;
  }

  disabled = g_build_filename (g_get_user_config_dir (), "gnosh", "disabled", NULL);
  if (g_file_test (disabled, G_FILE_TEST_EXISTS)) {
    g_log (LOG_DOMAIN, G_LOG_LEVEL_MESSAGE, "Disabled by %s", disabled);
    g_free (disabled);
    return;
  }
  g_free (disabled);

  env = g_getenv ("GNOSH_MAIN");
  if (env && *env)
    main_module = g_build_filename (env, NULL);
  else
    main_module = g_build_filename (g_get_user_data_dir (), "gnosh", "runtime", "shell", "main.js", NULL);

  if (!g_file_test (main_module, G_FILE_TEST_EXISTS)) {
    g_log (LOG_DOMAIN, G_LOG_LEVEL_WARNING, "gnosh runtime not found at %s", main_module);
    return;
  }

  if (!crash_guard_allows_start ())
    return;

  /* Wait for the main loop so Phosh has finished its own initialization. */
  g_idle_add (boot, NULL);
}
