begin;
create or replace function public.sanji_validate_deal_fee_terms() returns trigger language plpgsql set search_path='' as $$
declare f jsonb; n text; k text;
begin
 if new.kind<>'deal' or not (new.data ? 'feeTerms') then return new; end if;
 f:=new.data->'feeTerms';
 if jsonb_typeof(f)<>'object' or coalesce(f->>'ownership','unknown') not in ('unknown','owned','external') or coalesce(f->>'basis','unknown') not in ('unknown','creator_only','vendor_total') or coalesce(f->>'companyUnit','unknown') not in ('unknown','sale_percent','vendor_fee_percent') then raise exception '수수료 기준을 확인하세요';end if;
 foreach k in array array['creatorPercent','companyPercent'] loop
  if f ? k and f->k<>'null'::jsonb then
   if jsonb_typeof(f->k)<>'number' then raise exception '수수료율은 숫자여야 합니다';end if;
   n:=f->>k;if n::numeric<0 or n::numeric>100 then raise exception '수수료율은 0~100 사이여야 합니다';end if;
  end if;
 end loop;
 if f->'companyPercent' is not null and f->'companyPercent'<>'null'::jsonb and coalesce(f->>'companyUnit','unknown')='unknown' then raise exception '회사 배분율의 기준을 선택하세요';end if;
 return new;
end $$;
revoke all on function public.sanji_validate_deal_fee_terms() from public,anon,authenticated;
drop trigger if exists sanji_deal_fee_terms_guard on public.sanji_records;
create trigger sanji_deal_fee_terms_guard before insert or update of data on public.sanji_records for each row execute function public.sanji_validate_deal_fee_terms();
commit;
