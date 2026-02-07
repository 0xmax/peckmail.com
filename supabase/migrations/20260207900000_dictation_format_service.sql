-- Add 'dictation_format' to the allowed service values on credit_transactions
alter table credit_transactions
  drop constraint credit_transactions_service_check,
  add constraint credit_transactions_service_check
    check (service in ('tts', 'tts_enhance', 'chat', 'whisper', 'dictation_format'));
