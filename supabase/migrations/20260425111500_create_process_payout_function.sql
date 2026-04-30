create or replace function process_payout(p_payout_id uuid)
returns void as $$
declare
    v_client_id uuid;
    v_stripe_customer_id text;
    v_bank_account_token text;
    v_client_email text;
    v_client_name text;
    v_net_payout_amount numeric;
    v_stripe_transfer_id text;
    v_idempotency_key text;
begin
    -- Get payout details
    select p.client_id, p.net_payout_amount
    into v_client_id, v_net_payout_amount
    from payouts p
    where p.payout_id = p_payout_id
      and p.status = 'pending';

    if not found then
        raise exception 'Payout not found or not pending: %', p_payout_id;
    end if;

    -- Get client details
    select c.stripe_customer_id, c.bank_account_token, c.email, c.client_name
    into v_stripe_customer_id, v_bank_account_token, v_client_email, v_client_name
    from clients c
    where c.client_id = v_client_id;

    if not found then
        raise exception 'Client not found for payout: %', p_payout_id;
    end if;

    -- TODO: Integrate with Stripe to create actual transfer to bank account
    -- For now, we'll simulate the Stripe transfer and update the record
    
    -- Generate idempotency key
    v_idempotency_key := 'payout_' || p_payout_id || '_' || to_char(now(), 'YYYYMMDDHH24MISS');
    
    -- Simulate Stripe transfer (in production, this would call Stripe API)
    -- Example Stripe API call would be:
    -- stripe.transfers.create({
    --   amount: Math.round(v_net_payout_amount * 100), // convert to cents
    --   currency: 'usd',
    --   destination: v_bank_account_token,
    --   idempotency_key: v_idempotency_key,
    --   description: `Payout to ${v_client_name} for period ${v_period_start} to ${v_period_end}`
    -- });
    
    -- For now, generate a mock transfer ID
    v_stripe_transfer_id := 'po_' || substring(md5(random()::text || clock_timestamp()::text) from 1 for 24);
    
    -- Update payout record
    update payouts
    set 
        status = 'completed',
        payout_date = current_date,
        stripe_transfer_id = v_stripe_transfer_id,
        updated_at = now()
    where payout_id = p_payout_id;
    
    -- Log the payout completion
    raise notice 'Processed payout % for client % (%): net amount=%, stripe_transfer_id=%',
        p_payout_id, v_client_name, v_client_email, v_net_payout_amount, v_stripe_transfer_id;
        
    -- TODO: Send email notification to client about completed payout
    -- This would be implemented using a notification service or edge function
end;
$$ language plpgsql;