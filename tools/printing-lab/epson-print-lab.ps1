param(
  [string]$SupabaseUrl = "https://yqrilxnldkzmbhxzagaz.supabase.co",
  [string]$PublishableKey = "sb_publishable_CIUObRoqGCvXU13tLI-22w_01R_9gda",
  [string]$Username,
  [string]$AuthEmailBase = "srpopurr0000@gmail.com",
  [int]$PollSeconds = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Username)) {
  $Username = Read-Host "Usuario administrador"
}
$password = Read-Host "Contrasena del administrador" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$normalized = $Username.Trim().Normalize(
  [Text.NormalizationForm]::FormD
) -replace '\p{Mn}', ''
$normalized = $normalized.ToLowerInvariant()
if ($normalized -notmatch '^[a-z0-9._-]{1,49}$') {
  throw "Usuario invalido."
}

if ($AuthEmailBase -notmatch '^[^@]+@[^@]+$') {
  throw "AUTH_EMAIL_BASE invalido."
}
$emailParts = $AuthEmailBase.ToLowerInvariant().Split("@")
$email = "$($emailParts[0])+k-$normalized@$($emailParts[1])"

$loginBody = @{
  email = $email
  password = $plainPassword
} | ConvertTo-Json
$loginHeaders = @{
  apikey = $PublishableKey
  Authorization = "Bearer $PublishableKey"
}
$session = Invoke-RestMethod `
  -Method Post `
  -Uri "$($SupabaseUrl.TrimEnd('/'))/auth/v1/token?grant_type=password" `
  -Headers $loginHeaders `
  -ContentType "application/json" `
  -Body $loginBody

$accessToken = [string]$session.access_token
if ([string]::IsNullOrWhiteSpace($accessToken)) {
  throw "Supabase no devolvio una sesion autenticada."
}

$configDirectory = Join-Path $env:LOCALAPPDATA "PrintingLab"
$configPath = Join-Path $configDirectory "devices.json"
New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
$devices = if (Test-Path $configPath) {
  @(Get-Content -Raw -Path $configPath | ConvertFrom-Json)
} else {
  @()
}

$printerDefinitions = @(
  @{ Model = "TM-T20IV"; Port = 9100 },
  @{ Model = "TM-T88VII"; Port = 9101 }
)

foreach ($printer in $printerDefinitions) {
  $hardwareKey = "SIM-$($env:COMPUTERNAME)-$($printer.Model)-$($printer.Port)"
  $provisionBody = @{
    hardware_key = $hardwareKey
    model = "Epson Virtual $($printer.Model)"
  } | ConvertTo-Json
  $provisionHeaders = @{
    apikey = $PublishableKey
    Authorization = "Bearer $accessToken"
  }
  $provisioned = Invoke-RestMethod `
    -Method Post `
    -Uri "$($SupabaseUrl.TrimEnd('/'))/functions/v1/printing-device-provision" `
    -Headers $provisionHeaders `
    -ContentType "application/json" `
    -Body $provisionBody

  $existingIndex = [Array]::FindIndex(
    $devices,
    [Predicate[object]] { param($item) $item.hardware_key -eq $hardwareKey })
  $entry = [ordered]@{
    hardware_key = $hardwareKey
    model = "Epson Virtual $($printer.Model)"
    device_id = [string]$provisioned.device_id
    device_token = [string]$provisioned.device_token
    host = "127.0.0.1"
    port = $printer.Port
  }
  if ($existingIndex -ge 0) {
    $devices[$existingIndex] = $entry
  } else {
    $devices += $entry
  }

  Write-Host "Provisioned $($entry.model): $($entry.device_id)"
}

$devices | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8

foreach ($printer in $printerDefinitions) {
  $arguments = @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSScriptRoot\virtual-epson-printer.ps1`"",
    "-Model", $printer.Model,
    "-Port", $printer.Port
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

Write-Host "Laboratorio activo. Poll cada $PollSeconds segundos."
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
