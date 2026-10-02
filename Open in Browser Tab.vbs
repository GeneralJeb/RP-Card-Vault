' Opens RP Card Vault as an ordinary browser tab.
'
' Double-click this, or make a shortcut to it and pin that. It starts the
' server quietly if it isn't already running, exactly like the app-window
' launcher does, and uses the same address - so the same folders, tags and
' notes show up either way.

Option Explicit

Dim sh, fso, base, launcher
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = base & "\RP Card Vault.vbs"

If Not fso.FileExists(launcher) Then
  MsgBox "Can't find ""RP Card Vault.vbs"" in:" & vbCrLf & base & vbCrLf & vbCrLf & _
         "Keep all the vault files together in one folder.", _
         vbExclamation, "RP Card Vault"
  WScript.Quit 1
End If

' 0 = no console window, False = don't wait for it to finish
sh.Run "wscript.exe """ & launcher & """ tab", 0, False
