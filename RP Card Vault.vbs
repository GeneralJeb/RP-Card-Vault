' RP Card Vault launcher
'
' Starts the local server if it isn't already up (no console window), then
' opens the vault. This is the file the desktop/taskbar shortcuts point at.
'
' Usage:
'   wscript "RP Card Vault.vbs"        -> standalone app window (default)
'   wscript "RP Card Vault.vbs" tab    -> ordinary browser tab
'
' Both modes use the same browser and the same address, so they share one
' set of folder permissions, tags and notes.
'
' The port is 8790 unless a file named vault.local next to this one says
' otherwise (a line like  port=8791 ). Browser storage is keyed to the address,
' so each port is a separate vault: its own database and folder permissions.
' Give a second copy its own port and the two never see each other's data.
'
' Keep this file saved with CRLF (Windows) line endings. Windows Script Host
' treats a lone LF as whitespace rather than a line break, so a Unix-saved .vbs
' parses as one enormous line and dies with "syntax error, code 800A03EA".

Option Explicit

Dim mode
mode = "app"
If WScript.Arguments.Count > 0 Then mode = LCase(Trim(WScript.Arguments(0)))
If mode <> "tab" Then mode = "app"

Dim sh, fso, base
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)

' ---- this copy's own settings, from vault.local if there is one -------------
' Each line is name=value; unknown names are ignored.
Function LocalSetting(name, fallback)
  Dim f, line, k
  LocalSetting = fallback
  If Not fso.FileExists(base & "\vault.local") Then Exit Function
  Set f = fso.OpenTextFile(base & "\vault.local", 1)
  Do While Not f.AtEndOfStream
    line = Trim(f.ReadLine)
    k = InStr(line, "=")
    If k > 1 Then
      If LCase(Trim(Left(line, k - 1))) = LCase(name) Then LocalSetting = Trim(Mid(line, k + 1))
    End If
  Loop
  f.Close
End Function

Dim PORT, URL_APP, URL_STATUS
PORT = LocalSetting("port", "8790")
If Not IsNumeric(PORT) Then PORT = "8790"
URL_APP    = "http://127.0.0.1:" & PORT & "/RP_Card_Vault.html"
URL_STATUS = "http://127.0.0.1:" & PORT & "/__vault/status"

' ---- is the server already listening? -------------------------------------
Function ServerUp()
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP.6.0")
  ' Written as a block rather than a one-line If with a colon: the colon form is
  ' legal but is exactly the sort of thing that turns into a parse error after
  ' an editor reflows the file.
  If Err.Number <> 0 Then
    Err.Clear
    Set http = CreateObject("MSXML2.XMLHTTP")
  End If
  ' If both CreateObject calls failed, http.Open raises and On Error Resume Next
  ' swallows it - Err.Number is then non-zero and ServerUp stays False, which is
  ' the answer we want anyway.
  http.Open "GET", URL_STATUS, False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ServerUp = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

' ---- start it hidden if needed --------------------------------------------
Dim waited
If Not ServerUp() Then
  If Not fso.FileExists(base & "\serve.js") Then
    MsgBox "serve.js is missing from:" & vbCrLf & base & vbCrLf & vbCrLf & _
           "Keep RP_Card_Vault.html, serve.js and this launcher together in one folder.", _
           vbExclamation, "RP Card Vault"
    WScript.Quit 1
  End If
  ' 0 = hidden window, False = don't wait
  ' --restart: if a server is somehow already up but not answering our probe,
  ' the new one asks it to stand down over HTTP rather than colliding with it.
  ' A portable Node kept with the vault (node\node.exe, or node.exe here) comes
  ' first, so the vault runs from a USB drive on a computer without Node.
  Dim nodeExe
  nodeExe = "node"
  If fso.FileExists(base & "\node\node.exe") Then
    nodeExe = """" & base & "\node\node.exe"""
  ElseIf fso.FileExists(base & "\node.exe") Then
    nodeExe = """" & base & "\node.exe"""
  End If
  sh.Run "cmd /c cd /d """ & base & """ && " & nodeExe & " serve.js " & PORT & " --no-open --restart", 0, False

  waited = 0
  Do While waited < 8000 And Not ServerUp()
    WScript.Sleep 250
    waited = waited + 250
  Loop

  If Not ServerUp() Then
    MsgBox "Couldn't start the vault server." & vbCrLf & vbCrLf & _
           "Node.js 20 or newer needs to be installed. Try running" & vbCrLf & _
           """Start RP Card Vault.bat"" in the same folder to see the error.", _
           vbExclamation, "RP Card Vault"
    WScript.Quit 1
  End If
End If

' ---- open it, preferring a Chromium browser -------------------------------
Dim candidates, i, exe, found
candidates = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\BraveSoftware\Brave-Browser\Application\brave.exe"), _
  sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") )

found = ""
For i = 0 To UBound(candidates)
  exe = candidates(i)
  If found = "" And fso.FileExists(exe) Then found = exe
Next

If found <> "" Then
  If mode = "tab" Then
    ' Ordinary tab in the same browser - same profile, so the vault sees the
    ' same saved folders and tags as the app window does.
    sh.Run """" & found & """ """ & URL_APP & """", 1, False
  Else
    ' --app= gives a standalone window with its own taskbar entry
    sh.Run """" & found & """ --app=" & URL_APP, 1, False
  End If
Else
  ' No Chromium browser found - hand it to the default browser.
  sh.Run URL_APP, 1, False
End If
