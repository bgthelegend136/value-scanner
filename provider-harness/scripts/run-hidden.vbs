Option Explicit

Dim shell, args, scriptPath, command, i

Set args = WScript.Arguments
If args.Count < 1 Then
  WScript.Quit 2
End If

scriptPath = args.Item(0)
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Chr(34) & scriptPath & Chr(34)

For i = 1 To args.Count - 1
  command = command & " " & Chr(34) & args.Item(i) & Chr(34)
Next

Set shell = CreateObject("WScript.Shell")
WScript.Quit shell.Run(command, 0, True)
