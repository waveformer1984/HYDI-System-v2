Invoke-WebRequest -Uri "https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-connect-admin" `
  -Method POST `
  -Headers @{
    Authorization = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE"
    "Content-Type" = "application/json"
  } `
  -Body '{"action": "list"}' `
  -UseBasicParsing
