param(
  [ValidateSet("TM-T20IV", "TM-T88VII")]
  [string]$Model = "TM-T20IV",
  [ValidateRange(9100, 9999)]
  [int]$Port = 9100
)

$outputDirectory = Join-Path $PSScriptRoot "output\$Model-$Port"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$listener = [System.Net.Sockets.TcpListener]::new(
  [System.Net.IPAddress]::Loopback,
  $Port)
$listener.Start()

Write-Host "Virtual Epson $Model listening on 127.0.0.1:$Port"
Write-Host "Output: $outputDirectory"
Write-Host "Press Ctrl+C to stop."

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $buffer = New-Object byte[] 8192
      $data = New-Object System.IO.MemoryStream
      do {
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -gt 0) { $data.Write($buffer, 0, $read) }
      } while ($read -gt 0)

      $bytes = $data.ToArray()
      $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
      $baseName = "$stamp-$Model"
      [IO.File]::WriteAllBytes(
        (Join-Path $outputDirectory "$baseName.bin"),
        $bytes)

      $text = [Text.Encoding]::UTF8.GetString($bytes)
      $text = $text.Replace([string][char]27, "<ESC>")
      $text = $text.Replace([string][char]29, "<GS>")
      [IO.File]::WriteAllText(
        (Join-Path $outputDirectory "$baseName.txt"),
        $text,
        [Text.UTF8Encoding]::new($false))

      Write-Host "[$Model] Received $($bytes.Length) bytes"
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
