param(
  [ValidateSet('input', 'success', 'failure')][string]$Mode = 'input',
  [string]$Account = 'administrador',
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

if ($Mode -ne 'input') {
  $message = if ($Mode -eq 'success') {
    'Senha atualizada. Entre no painel com o mesmo e-mail e a nova senha.'
  } else {
    'A troca nao foi confirmada. Confira a chave secreta deste projeto e tente novamente. Nenhuma credencial foi salva em arquivo.'
  }
  [void][System.Windows.Forms.MessageBox]::Show($message, 'Senha do administrador')
  exit
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Trocar senha do administrador'
$form.ClientSize = New-Object System.Drawing.Size(550, 440)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

function Add-Label([string]$Text, [int]$Y) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.Location = New-Object System.Drawing.Point(22, $Y)
  $label.Size = New-Object System.Drawing.Size(506, 25)
  $form.Controls.Add($label)
  return $label
}

function Add-SecretBox([int]$Y, [int]$Width = 506) {
  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point(22, $Y)
  $box.Size = New-Object System.Drawing.Size($Width, 28)
  $box.UseSystemPasswordChar = $true
  $box.ShortcutsEnabled = $true
  $box.MaxLength = 4096
  $form.Controls.Add($box)
  return $box
}

[void](Add-Label "Conta: $Account" 18)
[void](Add-Label '1. Chave secreta do Supabase (sb_secret_)' 58)
$key = Add-SecretBox 85 390
$paste = New-Object System.Windows.Forms.Button
$paste.Text = 'Colar chave'
$paste.Location = New-Object System.Drawing.Point(422, 83)
$paste.Size = New-Object System.Drawing.Size(106, 31)
$form.Controls.Add($paste)
$count = Add-Label 'Nenhuma chave colada.' 118
$key.Add_TextChanged({
  $count.Text = if ($key.TextLength -gt 0) { "Chave preenchida: $($key.TextLength) caracteres." } else { 'Nenhuma chave colada.' }
})
$paste.Add_Click({
  if ([System.Windows.Forms.Clipboard]::ContainsText()) {
    $key.Text = [System.Windows.Forms.Clipboard]::GetText().Trim()
  } else {
    [void][System.Windows.Forms.MessageBox]::Show('Copie a chave no Supabase primeiro e clique aqui novamente.', 'Copiar chave')
  }
})
[void](Add-Label '2. Nova senha (12 a 128 caracteres)' 160)
$password = Add-SecretBox 187
$password.MaxLength = 128
[void](Add-Label '3. Repita a nova senha' 230)
$confirmation = Add-SecretBox 257
$confirmation.MaxLength = 128
[void](Add-Label 'Os campos ficam protegidos. Nada sera salvo em arquivo.' 300)
$submit = New-Object System.Windows.Forms.Button
$submit.Text = 'Atualizar senha'
$submit.Location = New-Object System.Drawing.Point(342, 354)
$submit.Size = New-Object System.Drawing.Size(186, 42)
$form.Controls.Add($submit)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancelar'
$cancel.Location = New-Object System.Drawing.Point(22, 354)
$cancel.Size = New-Object System.Drawing.Size(115, 42)
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($cancel)
$form.CancelButton = $cancel
$form.AcceptButton = $submit
$submit.Add_Click({
  if ([string]::IsNullOrWhiteSpace($key.Text)) {
    [void][System.Windows.Forms.MessageBox]::Show('Cole a chave secreta usando o botao Colar chave.', 'Falta a chave')
    return
  }
  if ($password.TextLength -lt 12) {
    [void][System.Windows.Forms.MessageBox]::Show('A nova senha precisa ter pelo menos 12 caracteres.', 'Confira a senha')
    return
  }
  if ($password.Text -cne $confirmation.Text) {
    [void][System.Windows.Forms.MessageBox]::Show('As duas senhas precisam ser iguais.', 'Confira a senha')
    return
  }
  $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Close()
})

if ($CheckOnly) {
  $form.Dispose()
  Write-Output 'Window initialization: OK'
  exit
}
$result = $form.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  # This output is captured only by the Node parent process, never printed or saved.
  $payload = @{ serviceRoleKey = $key.Text; password = $password.Text; confirmation = $confirmation.Text }
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::Write(($payload | ConvertTo-Json -Compress))
  $payload.Clear()
}
$key.Clear()
$password.Clear()
$confirmation.Clear()
$form.Dispose()
