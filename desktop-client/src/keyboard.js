// On-demand virtual keyboard for the touch terminal (Windows only).
//
// "touch": the modern Windows touch keyboard (TabTip). Simply launching
// TabTip.exe doesn't reliably show it on Windows 11, so we toggle it through
// its COM interface (ITipInvocation), from a short PowerShell snippet — no
// native module to compile. "osk": the classic On-Screen Keyboard (osk.exe),
// a floating window that always works, as a fallback or by choice.
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

const TOGGLE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$tabtip = Join-Path $env:CommonProgramW6432 'microsoft shared\\ink\\TabTip.exe'
if (-not (Get-Process TabTip -ErrorAction SilentlyContinue)) {
  Start-Process $tabtip
  Start-Sleep -Milliseconds 700
}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("37c994e7-432b-4834-a2f7-dce1f13b834b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ITipInvocation { void Toggle(IntPtr hwnd); }
public static class MdpTip {
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
  public static void Toggle() {
    var type = Type.GetTypeFromCLSID(new Guid("4ce576fa-83dc-4f88-951c-9d0782b4e376"));
    var tip = (ITipInvocation)Activator.CreateInstance(type);
    tip.Toggle(GetDesktopWindow());
  }
}
"@
[MdpTip]::Toggle()
`;

function runPowerShell(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 8000 },
      (err, _stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
  });
}

function openOsk() {
  const osk = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "osk.exe");
  spawn(osk, [], { detached: true, stdio: "ignore" }).unref();
}

async function toggleKeyboard(mode = "touch") {
  if (process.platform !== "win32") throw new Error("La tastiera virtuale è disponibile solo su Windows.");
  if (mode === "osk") { openOsk(); return "osk"; }
  try {
    await runPowerShell(TOGGLE_SCRIPT);
    return "touch";
  } catch (err) {
    console.error("[keyboard] Tastiera touch non disponibile, uso osk.exe:", err.message);
    openOsk();
    return "osk";
  }
}

module.exports = { toggleKeyboard };
