Set WshShell = CreateObject("WScript.Shell")

' Get script directory
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' Kill any existing server on port 5500
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr :5500 ^| findstr LISTENING') do taskkill /PID %a /F", 0, True

' Start Node server hidden (0 = hidden window)
WshShell.Run "cmd /c cd /d """ & scriptDir & """ && node server.js", 0, False

' Wait 1 second for server to start
WScript.Sleep 1000

' Open browser
WshShell.Run "http://localhost:5500"
