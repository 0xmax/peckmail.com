-- Switch handle generation to bird-nature naming scheme (matching email style)

-- Bird and nature word arrays for handle generation
create or replace function public.generate_bird_handle()
returns text as $$
declare
  birds text[] := array[
    'robin', 'wren', 'finch', 'sparrow', 'dove', 'lark', 'swift', 'heron',
    'crane', 'piper', 'plover', 'falcon', 'osprey', 'kestrel', 'merlin',
    'oriole', 'cedar', 'tanager', 'vireo', 'pipit', 'dunlin', 'avocet',
    'curlew', 'thrush', 'dipper', 'grouse', 'petrel', 'tern', 'shrike',
    'linnet'
  ];
  nature text[] := array[
    'meadow', 'brook', 'willow', 'cedar', 'aspen', 'maple', 'birch', 'holly',
    'fern', 'moss', 'sage', 'thyme', 'laurel', 'ivy', 'clover', 'hazel',
    'amber', 'coral', 'pearl', 'frost', 'mist', 'dew', 'glen', 'vale',
    'cove', 'ridge', 'dale', 'heath', 'marsh', 'briar'
  ];
  bird text;
  word text;
  candidate text;
  attempts int := 0;
begin
  loop
    bird := birds[1 + floor(random() * array_length(birds, 1))::int];
    word := nature[1 + floor(random() * array_length(nature, 1))::int];
    candidate := bird || word;
    -- After a few tries, append a number for uniqueness
    if attempts > 5 then
      candidate := candidate || floor(random() * 100)::int::text;
    end if;
    exit when not exists (select 1 from public.profiles where handle = candidate);
    attempts := attempts + 1;
    if attempts > 20 then
      -- Fallback: use bird + random hex
      candidate := bird || substr(md5(random()::text), 1, 6);
      exit;
    end if;
  end loop;
  return candidate;
end;
$$ language plpgsql;

-- Backfill existing users that have name-derived handles with bird handles
update public.profiles
set handle = public.generate_bird_handle()
where handle is not null;

-- Update signup trigger to use bird handles
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url, handle)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url',
    public.generate_bird_handle()
  );
  return new;
end;
$$ language plpgsql security definer;
