param(
  [string]$SupabaseUrl = "",
  [string]$PublishableKey = "",
  [string]$ConnectionDataPath = (Join-Path $env:LOCALAPPDATA "BPrint\connection.dat"),
  [string]$PrintersJsonPath = (Join-Path $env:LOCALAPPDATA "BPrint\printers.json"),
  [int]$PollSeconds = 2,
  [switch]$AllowProduction
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path $ConnectionDataPath)) {
  throw "No existe $ConnectionDataPath. Abre BPrint, inicia sesión y agrega las impresoras."
}
if (-not (Test-Path $PrintersJsonPath)) {
  throw "No existe $PrintersJsonPath. Agrega las impresoras virtuales desde BPrint."
}

$encryptedConnection = [IO.File]::ReadAllBytes($ConnectionDataPath)
$clearConnection = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $encryptedConnection,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
$connection = [Text.Encoding]::UTF8.GetString($clearConnection) | ConvertFrom-Json
[System.Security.Cryptography.CryptographicOperations]::ZeroMemory($clearConnection)
if ([string]::IsNullOrWhiteSpace($SupabaseUrl)) { $SupabaseUrl = [string]$connection.supabaseUrl }
if ([string]::IsNullOrWhiteSpace($PublishableKey)) { $PublishableKey = [string]$connection.publishableKey }
if ([string]::IsNullOrWhiteSpace($SupabaseUrl) -or [string]::IsNullOrWhiteSpace($PublishableKey)) {
  throw "Indica la URL y la clave pública de un proyecto Supabase de pruebas."
}
if ($SupabaseUrl -match "yqrilxnldkzmbhxzagaz\.supabase\.co" -and -not $AllowProduction) {
  throw "Este laboratorio no puede operar el proyecto de producción sin pasar -AllowProduction explícitamente. Usa primero un proyecto Supabase de pruebas."
}
$devices = @($connection.devices)
if ($devices.Count -eq 0) {
  throw "BPrint todavía no tiene dispositivos provisionados en $ConnectionDataPath. Agrega las impresoras Epson desde BPrint."
}

$printerConfiguration = Get-Content -Raw -Path $PrintersJsonPath | ConvertFrom-Json
$printerEntries = @($printerConfiguration.queueNames)
if ($printerEntries.Count -eq 0) {
  throw "BPrint no tiene colas Epson virtuales configuradas en $PrintersJsonPath."
}

function Get-BPrintHardwareKey([string]$HardwareIdentity, [string]$QueueName, [string]$PortName) {
  $identity = if ([string]::IsNullOrWhiteSpace($HardwareIdentity)) {
    "$env:COMPUTERNAME|$QueueName|$PortName"
  } else {
    $HardwareIdentity
  }
  $shaProvider = [Security.Cryptography.SHA256]::Create()
  try {
    $sha = $shaProvider.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))
    return "BPRINT-" + [BitConverter]::ToString($sha).Replace("-", "").Substring(0, 32)
  } finally {
    $shaProvider.Dispose()
  }
}

$labDevices = @()
$emulatorProcesses = @()
for ($index = 0; $index -lt $printerEntries.Count; $index++) {
  $queueName = [string]$printerEntries[$index]
  $metadata = $null
  if ($null -ne $printerConfiguration.metadata.PSObject.Properties[$queueName]) {
    $metadata = $printerConfiguration.metadata.PSObject.Properties[$queueName].Value
  }
  $portName = if ($metadata) { [string]$metadata.portName } else { "" }
  $hardwareIdentity = if ($metadata) { [string]$metadata.hardwareIdentity } else { "" }
  $hardwareKey = Get-BPrintHardwareKey $hardwareIdentity $queueName $portName
  $device = $devices | Where-Object { $_.hardwareKey -eq $hardwareKey } | Select-Object -First 1
  if (-not $device) { continue }
  $devicePort = 9100 + $labDevices.Count
  $deviceModel = "TM-T20IV"
  if ($labDevices.Count -gt 0) { $deviceModel = "TM-T88VII" }
  if ($metadata -and -not [string]::IsNullOrWhiteSpace([string]$metadata.model)) {
    $deviceModel = [string]$metadata.model
  }
  $device | Add-Member -NotePropertyName host -NotePropertyValue "127.0.0.1" -Force
  $device | Add-Member -NotePropertyName port -NotePropertyValue $devicePort -Force
  $device | Add-Member -NotePropertyName model -NotePropertyValue $deviceModel -Force
  $device | Add-Member -NotePropertyName queue_name -NotePropertyValue $queueName -Force
  $device | Add-Member -NotePropertyName device_id -NotePropertyValue ([string]$device.deviceId) -Force
  $device | Add-Member -NotePropertyName device_token -NotePropertyValue ([string]$device.deviceToken) -Force
  $labDevices += $device
}

if ($labDevices.Count -eq 0) {
  throw "No hay impresoras provisionadas que coincidan con las colas locales de BPrint."
}

foreach ($device in $labDevices) {
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
  $emulatorProcesses += Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -PassThru -ArgumentList $arguments
}

$instanceId = [guid]::NewGuid().ToString()
$pendingResults = @()

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

Write-Host "Laboratorio activo. No inicia sesiones ni registra dispositivos. BPrint debe estar cerrado."
Write-Host "Ctrl+C para detener."

try {
  while ($true) {
    $batchDevices = @($labDevices | ForEach-Object {
      @{ device_id = $_.device_id; device_token = $_.device_token }
    })
    $batchResults = @($pendingResults | Select-Object -First 100)
    $body = @{
      p_devices = $batchDevices
      p_results = $batchResults
      p_instance_id = $instanceId
    } | ConvertTo-Json -Depth 8
    $headers = @{
      apikey = $PublishableKey
      Authorization = "Bearer $PublishableKey"
    }

    try {
      $operation = Invoke-RestMethod `
        -Method Post `
        -Uri "$($SupabaseUrl.TrimEnd('/'))/rest/v1/rpc/operate_printing_batch" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $body

      foreach ($reported in @($operation.results)) {
        $pendingResults = @($pendingResults | Where-Object { $_.job_id -ne $reported.job_id })
        if ($reported.status -notin @("reported", "already_reported")) {
          Write-Warning "Job $($reported.job_id): $($reported.status)"
        }
      }

      foreach ($deviceOperation in @($operation.devices)) {
        if ($deviceOperation.mode -eq "ownership_lost") {
          Write-Warning "[$($deviceOperation.device_id)] Otra instancia mantiene esta impresora."
          continue
        }
        if (-not $deviceOperation.job) { continue }

        $device = $labDevices | Where-Object { $_.device_id -eq [string]$deviceOperation.device_id } | Select-Object -First 1
        if (-not $device) { continue }
        $job = $deviceOperation.job
        $result = "success"
        $error = $null
        try {
          $ticket = ConvertFrom-EscPosText $job
          $copies = [Math]::Clamp([int]$job.route.copies, 1, 10)
          for ($copy = 0; $copy -lt $copies; $copy++) {
            Send-EscPos $device.host ([int]$device.port) $ticket
          }
        } catch {
          $result = "failed"
          $error = $_.Exception.Message
        }
        $pendingResults += @{
          device_id = $device.device_id
          device_token = $device.device_token
          job_id = [string]$job.id
          result = $result
          error = $error
        }
        Write-Host "[$($device.model)] Job $($job.id): $result (resultado en el próximo lote)"
      }
      $serverPollSeconds = @($operation.devices | ForEach-Object { [int]$_.poll_after_seconds } | Measure-Object -Minimum).Minimum
      if (-not $serverPollSeconds) { $serverPollSeconds = 10 }
      $PollSeconds = [Math]::Clamp($serverPollSeconds, 2, 10)
    } catch {
      Write-Warning "Fallo de operación batch: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $PollSeconds
  }
} finally {
  foreach ($process in $emulatorProcesses) {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  }
  Write-Host "Laboratorio detenido."
}
