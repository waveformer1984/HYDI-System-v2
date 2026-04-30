create or replace function generate_monthly_payouts()
returns void as $$
declare
    v_stripe_customer_id text;
    v_client_id uuid;
    v_client_email text;
    v_client_name text;
    v_gross numeric;
    v_platform_fee numeric;
    v_agent_fee numeric;
    v_net numeric;
    v_period_start date;
    v_period_end date;
    v_payout_id uuid;
begin
    -- Calculate previous month's date range
    v_period_start := date_trunc('month', current_date) - interval '1 month';
    v_period_end := date_trunc('month', current_date) - interval '1 day';

    -- For each client with transactions in the previous month
    for v_stripe_customer_id in
        select distinct stripe_customer_id
        from ledger
        where timestamp >= v_period_start
          and timestamp < v_period_end + interval '1 day'
          and stripe_customer_id is not null
    loop
        -- Get client details
        select client_id, email, client_name
        into v_client_id, v_client_email, v_client_name
        from clients
        where stripe_customer_id = v_stripe_customer_id;

        -- Skip if client not found
        if v_client_id is null then
            raise notice 'Client not found for stripe_customer_id: %', v_stripe_customer_id;
            continue;
        end if;

        -- Calculate sums for the period
        select coalesce(sum(amount_gross), 0),
               coalesce(sum(platform_fee_amount), 0),
               coalesce(sum(agent_fee_amount), 0)
        into v_gross, v_platform_fee, v_agent_fee
        from ledger
        where stripe_customer_id = v_stripe_customer_id
          and timestamp >= v_period_start
          and timestamp < v_period_end + interval '1 day';

        -- Calculate net amount
        v_net := v_gross - v_platform_fee - v_agent_fee;

        -- Insert payout record
        insert into payouts (
            client_id,
            period_start,
            period_end,
            gross_earnings,
            platform_fee_amount,
            agent_fee_amount,
            net_payout_amount,
            status
        ) values (
            v_client_id,
            v_period_start,
            v_period_end,
            v_gross,
            v_platform_fee,
            v_agent_fee,
            v_net,
            'pending'
        )
        returning payout_id into v_payout_id;

        -- Log the payout creation
        raise notice 'Created payout % for client % (%): gross=%, platform_fee=%, agent_fee=%, net=%',
            v_payout_id, v_client_name, v_client_email,
            v_gross, v_platform_fee, v_agent_fee, v_net;

        -- TODO: Send email notification to client with earnings summary
        -- This would be implemented using a notification service or edge function
    end loop;
end;
$$ language plpgsql;