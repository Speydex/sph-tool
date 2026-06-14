# Wrapper fuer die geplante Aufgabe:
#  - startet den Hausaufgaben-Check (read-only)
#  - schreibt ein Log
#  - zeigt bei OFFENEN Hausaufgaben eine Windows-Benachrichtigung
#
# Wird von der geplanten Aufgabe um 13:00 / 15:00 / 18:00 aufgerufen.

$ErrorActionPreference = "Stop"
$proj   = "C:\Users\stark\claude ordner\sph-tool"
$python = Join-Path $proj ".venv\Scripts\python.exe"
$script = Join-Path $proj "offene_aufgaben.py"
$status = Join-Path $proj "output\offen_status.json"
$logDir = Join-Path $proj "logs"
$log    = Join-Path $logDir "check.log"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Write-Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $log -Value $line -Encoding utf8
}

function Show-Toast($title, $message) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
        [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType=WindowsRuntime]        | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]          | Out-Null
        $tmpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $texts = $tmpl.GetElementsByTagName("text")
        $texts.Item(0).AppendChild($tmpl.CreateTextNode($title))   | Out-Null
        $texts.Item(1).AppendChild($tmpl.CreateTextNode($message)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification $tmpl
        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    } catch {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($message, $title) | Out-Null
    }
}

try {
    & $python $script --headless | Out-Null

    if (-not (Test-Path $status)) {
        Write-Log "FEHLER: keine Status-Datei erzeugt."
        Show-Toast "Schulportal-Check" "Fehler beim Auslesen - siehe logs\check.log"
        exit 1
    }

    $data = Get-Content $status -Raw -Encoding utf8 | ConvertFrom-Json
    $n = [int]$data.anzahl_offen
    $v = [int]$data.anzahl_vertretungen

    $teile = @()
    if ($n -gt 0) { $teile += ("{0} offene HA: {1}" -f $n, (($data.offen | ForEach-Object { $_.kurs }) -join ", ")) }
    if ($v -gt 0) { $teile += ("{0} Vertretung(en): {1}" -f $v, (($data.vertretungen | ForEach-Object { ("{0} {1}" -f $_.datum, $_.fach) }) -join ", ")) }

    if ($teile.Count -gt 0) {
        $msg = $teile -join "  |  "
        Write-Log $msg
        Show-Toast "Schulportal-Update" $msg
    } else {
        Write-Log "Nichts Neues (keine offenen HA, keine Vertretungen)."
    }
} catch {
    Write-Log ("AUSNAHME: " + $_.Exception.Message)
    Show-Toast "Schulportal-Check" ("Fehler: " + $_.Exception.Message)
    exit 1
}
