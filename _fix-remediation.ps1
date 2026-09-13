$files = @(
  'lib/operational/CredentialGovernanceDashboard.ts',
  'lib/operational/CredentialGovernanceChatRouter.ts',
  'lib/operational/ReleaseCertificationGenerator.ts'
)
foreach ($f in $files) {
  $c = Get-Content $f -Raw
  $c = $c -replace '\.remediationStatus', '.remediation.status'
  Set-Content $f $c
}
