"""B33: Windows PowerShell ends a '...' string not only at the ASCII quote but
also at U+2018-U+201B (‘ ’ ‚ ‛). Two places put a local path inside '...' and
only doubled the ASCII quote:

* cleanup_orphan_webview (app/windows_desktop.py) built a -Command script with
  the WebView2 profile path, so a profile under C:\\Users\\O’Brien failed to
  parse (the cleanup silently did nothing) and a crafted folder name could end
  the string and run its own command;
* Register-RestoreAtLogon (directory update helper) wrote restore-<token>.ps1
  with the install, backup and log paths the same way.

Both now double every one of the five quotes. The portable tests check the
escaping itself; the Windows tests run it through real powershell.exe."""
import os
import subprocess
import unittest
import inspect

from app import windows_desktop
from app.windows_desktop import WindowsUpdater, ps_single_quoted

QUOTES = "'\u2018\u2019\u201a\u201b"
SAMPLES = [
    "C:\\Users\\O'Brien\\AppData",
    "C:\\Users\\O\u2019Brien\\AppData",
    "C:\\Users\\\u5f20 \u4e09\\\u2018a\u201ab\u201bc\u2019",
    # Would end the string and run Write-Output if only ' were doubled.
    "C:\\x\u2019; Write-Output PWNED; \u2019",
    "C:\\x'; Write-Output PWNED; '",
    "",
]


def old_escape(value):
    return "'" + value.replace("'", "''") + "'"


class PortableQuoteTest(unittest.TestCase):
    def test_every_powershell_single_quote_is_doubled(self):
        for quote in QUOTES:
            self.assertEqual(ps_single_quoted("a" + quote + "b"), "'a" + quote * 2 + "b'")
        self.assertEqual(ps_single_quoted("C:\\Users\\\u5f20 \u4e09"), "'C:\\Users\\\u5f20 \u4e09'")
        self.assertEqual(ps_single_quoted(""), "''")

    def test_other_quote_like_characters_are_left_alone(self):
        # Double quotes and backticks have no meaning inside '...'.
        value = 'a"b`c\u201cd\u201de$f'
        self.assertEqual(ps_single_quoted(value), "'" + value + "'")

    def test_webview_cleanup_uses_the_full_escape(self):
        source = inspect.getsource(windows_desktop.cleanup_orphan_webview)
        self.assertIn("ps_single_quoted(path)", source)
        self.assertNotIn('.replace("\'", "\'\'")', source)

    def test_restore_script_escapes_every_single_quote(self):
        helper = WindowsUpdater._directory_helper_source()
        body = helper.split("function Register-RestoreAtLogon", 1)[1].split("\nfunction ", 1)[0]
        self.assertNotIn('.Replace("\'", "\'\'")', body)
        self.assertIn("$quotes = \"['\\u2018-\\u201B]\"", body)
        for name in ("$TargetDir", "$Backup", "$LogPath"):
            self.assertIn(name + " -replace $quotes, '$0$0'", body)


@unittest.skipUnless(os.name == "nt", "needs Windows PowerShell")
class RealPowerShellQuoteTest(unittest.TestCase):
    def evaluate(self, literal):
        script = ("[Console]::OutputEncoding = [Text.Encoding]::UTF8; "
                  "$root = " + literal + "; [Console]::Out.Write('<' + $root + '>')")
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return result.returncode, result.stdout.decode("utf-8", "replace")

    def test_quoted_value_reads_back_unchanged(self):
        for value in SAMPLES:
            with self.subTest(value=ascii(value)):
                code, out = self.evaluate(ps_single_quoted(value))
                self.assertEqual(code, 0)
                self.assertEqual(out, "<" + value + ">")
                self.assertNotIn("PWNED\n", out.replace("\r", ""))

    def test_ascii_only_escape_breaks_on_a_curly_quote(self):
        # Counter-example: the old escaping on the value that broke it.
        code, out = self.evaluate(old_escape("C:\\Users\\O\u2019Brien\\AppData"))
        self.assertNotEqual((code, out), (0, "<C:\\Users\\O\u2019Brien\\AppData>"))


if __name__ == "__main__":
    unittest.main()
