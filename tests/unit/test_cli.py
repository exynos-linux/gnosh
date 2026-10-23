# SPDX-License-Identifier: GPL-3.0-or-later
"""Unit tests for the gnosh command (no Phosh needed)."""

import importlib.machinery
import importlib.util
import os
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
loader = importlib.machinery.SourceFileLoader("gnosh_cli", str(ROOT / "bin" / "gnosh"))
spec = importlib.util.spec_from_loader("gnosh_cli", loader)
gnosh = importlib.util.module_from_spec(spec)
loader.exec_module(gnosh)


class PickBuild(unittest.TestCase):
    def test_prefers_emulated_version(self):
        m = {"48": {"pk": 1, "version": 10}, "50": {"pk": 2, "version": 12}, "51": {"pk": 3, "version": 13}}
        with mock.patch.object(gnosh, "emulated_shell_version", return_value="50.0"):
            self.assertEqual(gnosh.pick_build(m)["pk"], 2)

    def test_falls_back_to_newest_older(self):
        m = {"45": {"pk": 1, "version": 1}, "47": {"pk": 2, "version": 2}, "44": {"pk": 0, "version": 0}}
        with mock.patch.object(gnosh, "emulated_shell_version", return_value="50.0"):
            self.assertEqual(gnosh.pick_build(m)["pk"], 2)

    def test_uses_newer_if_nothing_older(self):
        m = {"51": {"pk": 9, "version": 9}}
        with mock.patch.object(gnosh, "emulated_shell_version", return_value="50.0"):
            self.assertEqual(gnosh.pick_build(m)["pk"], 9)

    def test_rejects_legacy_only(self):
        m = {"42": {"pk": 1, "version": 1}, "44": {"pk": 2, "version": 2}}
        self.assertIsNone(gnosh.pick_build(m))


class GVariantParsing(unittest.TestCase):
    def test_string_tuple(self):
        self.assertEqual(gnosh.parse_gvariant_string("('{\"a\": 1}',)"), '{"a": 1}')

    def test_escapes(self):
        self.assertEqual(gnosh.parse_gvariant_string("('it\\'s \\u00e9',)"), "it's é")

    def test_gvariant_str(self):
        self.assertEqual(gnosh.gvariant_str("a'b"), "'a\\'b'")


class PhoshOnly(unittest.TestCase):
    def test_refuses_gnome(self):
        with mock.patch.dict(os.environ, {"XDG_CURRENT_DESKTOP": "GNOME", "GNOSH_FORCE": ""}):
            self.assertFalse(gnosh.in_phosh_session())

    def test_accepts_phosh(self):
        with mock.patch.dict(os.environ, {"XDG_CURRENT_DESKTOP": "Phosh:GNOME", "GNOSH_FORCE": ""}):
            self.assertTrue(gnosh.in_phosh_session())

    def test_ssh_falls_back_to_process(self):
        env = {k: v for k, v in os.environ.items() if k != "XDG_CURRENT_DESKTOP"}
        env["GNOSH_FORCE"] = ""
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(gnosh, "phosh_running", return_value=1234):
            self.assertTrue(gnosh.in_phosh_session())
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(gnosh, "phosh_running", return_value=None):
            self.assertFalse(gnosh.in_phosh_session())

    def test_commands_refuse_outside_phosh(self):
        with mock.patch.dict(os.environ, {"XDG_CURRENT_DESKTOP": "KDE", "GNOSH_FORCE": ""}):
            with self.assertRaises(SystemExit) as cm:
                gnosh.main(["list"])
            self.assertEqual(cm.exception.code, 2)


class Versions(unittest.TestCase):
    def test_version_tuple(self):
        self.assertGreater(gnosh.version_tuple("0.2.0"), gnosh.version_tuple("0.1.9"))
        self.assertEqual(gnosh.version_tuple("v1.2.3"), (1, 2, 3))


if __name__ == "__main__":
    unittest.main()
