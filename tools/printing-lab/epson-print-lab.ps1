param(
  [string]$SupabaseUrl = "https://yqrilxnldkzmbhxzagaz.supabase.co",
  [string]$PublishableKey = "sb_publishable_CIUObRoqGCvXU13tLI-22w_01R_9gda",
  [string]$ConnectionJsonPath = (Join-Path $env:LOCALAPPDATA "BPrint\connection.json"),
  [string]$PrintersJsonPath = (Join-Path $env:LOCALAPPDATA "BPrint\printers.json"),
  [int]$PollSeconds = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path $ConnectionJsonPath)) {
  throw "No existe $ConnectionJsonPath. Abre BPrint, inicia sesión y agrega las impresoras."
}
if (-not (Test-Path $PrintersJsonPath)) {
  throw "No existe $PrintersJsonPath. Agrega las impresoras virtuales desde BPrint."
}

$connection = Get-Content -Raw -Path $ConnectionJsonPath | ConvertFrom-Json
$devices = @($connection.devices)
if ($devices.Count -eq 0) {
  throw "BPrint todavía no tiene dispositivos provisionados en $ConnectionJsonPath. Agrega las impresoras Epson desde BPrint."
}

$printerConfiguration = Get-Content -Raw -Path $PrintersJsonPath | ConvertFrom-Json
$printerEntries = @($printerConfiguration.queueNames)
if ($printerEntries.Count -eq 0) {
  throw "BPrint no tiene colas Epson virtuales configuradas en $PrintersJsonPath."
}

for ($index = 0; $index -lt $devices.Count; $index++) {
  $devicePort = 9100 + $index
  $deviceModel = "TM-T20IV"
  if ($index -gt 0) { $deviceModel = "TM-T88VII" }
  $queueName = [string]$printerEntries[$index]
  if ($null -ne $printerConfiguration.metadata.PSObject.Properties[$queueName]) {
    $metadata = $printerConfiguration.metadata.PSObject.Properties[$queueName].Value
    if (-not [string]::IsNullOrWhiteSpace([string]$metadata.model)) {
      $deviceModel = [string]$metadata.model
    }
  }
  $devices[$index] | Add-Member -NotePropertyName host -NotePropertyValue "127.0.0.1" -Force
  $devices[$index] | Add-Member -NotePropertyName port -NotePropertyValue $devicePort -Force
  $devices[$index] | Add-Member -NotePropertyName model -NotePropertyValue $deviceModel -Force
  $devices[$index] | Add-Member -NotePropertyName queue_name -NotePropertyValue $queueName -Force
  $devices[$index] | Add-Member -NotePropertyName device_id -NotePropertyValue ([string]$devices[$index].deviceId) -Force
  $devices[$index] | Add-Member -NotePropertyName device_token -NotePropertyValue ([string]$devices[$index].deviceToken) -Force
}

foreach ($device in $devices) {
  $deviceModel = if ([string]::IsNullOrWhiteSpace([string]$device.model)) {
    "Virtual Epson"
  } else {
    [string]$device.model
  }
  $devicePort = if ($null -ne $device.port) { [int]$device.port } else { 9100 }
  $listenerModel = if ($deviceModel -match "T88") { "TM-T88VII" } else { "TM-T20IV" }
  $arguments = @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSScriptRoot\virtual-epson-printer.ps1`"",
    "-Model", $listenerModel,
    "-Port", $devicePort
  )
  Start-Process -FilePath "powershell.exe" -ArgumentList $arguments
}

function ConvertFrom-EscPosText([object]$Job) {
  $route = $Job.route
  $payload = $Job.payload
  $template = $route.template
  $width = 48
  if ($template -and [int]$template.paper_width_mm -eq 58) { $width = 32 }

  $lines = New-Object Collections.Generic.List[string]
  $lines.Add("BLACK&WHITE POS")
  $lines.Add("----------------")
  if ($template -and $template.header) {
    foreach ($line in @($template.header.lines)) { if ($line) { $lines.Add([string]$line) } }
  }
  $lines.Add("")
  $lines.Add("Punto: $($route.point_name)")
  $lines.Add("Evento: $($Job.payload.event_key)")
  $lines.Add("Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
  $lines.Add("")

  $lines.Add(($payload | ConvertTo-Json -Depth 8 -Compress))

  if ($template -and $template.footer) {
    $lines.Add("")
    foreach ($line in @($template.footer.lines)) { if ($line) { $lines.Add([string]$line) } }
  }
  return $lines -join "`r`n"
}

function Send-EscPos([string]$HostName, [int]$PrinterPort, [string]$Text) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $client.Connect($HostName, $PrinterPort)
    $stream = $client.GetStream()
    $bytes = New-Object Collections.Generic.List[byte]
    foreach ($byte in [byte[]](27,64,27,97,1)) { $bytes.Add($byte) }
    foreach ($byte in [Text.Encoding]::UTF8.GetBytes($Text)) { $bytes.Add($byte) }
    foreach ($byte in [byte[]](10,10,10,29,86,0)) { $bytes.Add($byte) }
    $stream.Write($bytes.ToArray(), 0, $bytes.Count)
    $stream.Flush()
  } finally {
    if ($client) { $client.Close() }
  }
}

Write-Host "Laboratorio activo. No inicia sesiones ni registra dispositivos. Poll cada $PollSeconds segundos."
Write-Host "Ctrl+C para detener."

try {
  while ($true) {
    foreach ($device in $devices) {
      $body = @{
        p_device_id = $device.device_id
        p_device_token = $device.device_token
        p_job_id = $null
        p_result = $null
        p_error = $null
      } | ConvertTo-Json
      $headers = @{
        apikey = $PublishableKey
        Authorization = "Bearer $PublishableKey"
      }

      try {
        $operation = Invoke-RestMethod `
          -Method Post `
          -Uri "$($SupabaseUrl.TrimEnd('/'))/rest/v1/rpc/operate_printing_device" `
          -Headers $headers `
          -ContentType "application/json" `
          -Body $body

        if ($operation.job) {
          $job = $operation.job
          $ticket = ConvertFrom-EscPosText $job
          try {
            Send-EscPos $device.host ([int]$device.port) $ticket
            $copies = [Math]::Clamp([int]$job.route.copies, 1, 10)
            for ($copy = 1; $copy -lt $copies; $copy++) {
              Send-EscPos $device.host ([int]$device.port) $ticket
            }
            $result = "success"
            $error = $null
          } catch {
            $result = "failed"
            $error = $_.Exception.Message
          }

          $completeBody = @{
            p_device_id = $device.device_id
            p_device_token = $device.device_token
            p_job_id = $job.id
            p_result = $result
            p_error = $error
          } | ConvertTo-Json
          Invoke-RestMethod `
            -Method Post `
            -Uri "$($SupabaseUrl.TrimEnd('/'))/rest/v1/rpc/operate_printing_device" `
            -Headers $headers `
            -ContentType "application/json" `
            -Body $completeBody
          Write-Host "[$($device.model)] Job $($job.id): $result"
        }
      } catch {
        Write-Warning "[$($device.model)] $($_.Exception.Message)"
      }
    }
    Start-Sleep -Seconds $PollSeconds
  }
} finally {
  Write-Host "Laboratorio detenido."
}
