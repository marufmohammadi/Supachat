export const SUPABASE_SCHEMA_SQL = `-- 1. CREATE USER PROFILES TABLE WITH INSTAGRAM-STYLE UNIQUE USERNAME SYSTEM
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL, -- Handle/username e.g. maruf
  display_name TEXT,             -- Full Display Name e.g. Maruf Mohammadi
  email TEXT,                    -- Email address for username login lookup
  avatar_url TEXT,
  public_key TEXT, -- Holds the client's RSA-OAEP public key in JWK format
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Force add columns if table already existed without them
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Backfill display_name if null
UPDATE public.profiles SET display_name = username WHERE display_name IS NULL OR display_name = '';

-- Ensure unique index on lower(username)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower ON public.profiles (LOWER(username));

-- Trigger function to automatically lower and trim username
CREATE OR REPLACE FUNCTION public.clean_username()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.username IS NOT NULL THEN
    NEW.username := LOWER(TRIM(NEW.username));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clean_username ON public.profiles;
CREATE TRIGGER trg_clean_username
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.clean_username();

-- 2. CREATE CHAT GROUPS TABLE
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. CREATE GROUP MEMBERSHIP LINK TABLE (With Indexes and unique constraint)
CREATE TABLE IF NOT EXISTS public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (group_id, user_id)
);

-- 4. CREATE ENCRYPTED CHAT MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- Null for group messages
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,       -- Null for 1-to-1 messages
  encrypted_body TEXT NOT NULL,         -- Message ciphertext (AES-GCM encoded)
  sender_encrypted_key TEXT,           -- Symmetric key encrypted with sender's public key (so they can read it back)
  receiver_encrypted_key TEXT,         -- Symmetric key encrypted with receiver's public key
  is_encrypted BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  -- Prevent message from being orphaned or having multiple targets
  CONSTRAINT message_destination CHECK (
    (receiver_id IS NOT NULL AND group_id IS NULL) OR
    (receiver_id IS NULL AND group_id IS NOT NULL)
  )
);

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_encrypted_key TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS receiver_encrypted_key TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS message_mode TEXT DEFAULT 'normal';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS view_once BOOLEAN DEFAULT FALSE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS opened_by JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS destroyed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Create highly performant indexes on foreign keys
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON public.messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_group_id ON public.messages(group_id);

-- 5. AUTOMATIC PROFILE SIGNUP TRIGGER HOOK
-- Copies user info automatically from auth.users metadata when signup happens
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  raw_un TEXT;
  clean_un TEXT;
  disp_name TEXT;
BEGIN
  raw_un := COALESCE(new.raw_user_meta_data->>'username', SPLIT_PART(new.email, '@', 1));
  clean_un := LOWER(REGEXP_REPLACE(raw_un, '[^a-zA-Z0-9_.]', '', 'g'));
  IF LENGTH(clean_un) < 3 THEN
    clean_un := clean_un || '123';
  END IF;
  IF LENGTH(clean_un) > 30 THEN
    clean_un := SUBSTRING(clean_un FROM 1 FOR 30);
  END IF;

  disp_name := COALESCE(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username', SPLIT_PART(new.email, '@', 1));

  INSERT INTO public.profiles (id, username, display_name, email, avatar_url)
  VALUES (
    new.id,
    clean_un,
    disp_name,
    new.email,
    COALESCE(new.raw_user_meta_data->>'avatar_url', 'https://api.dicebear.com/7.x/adventurer/svg?seed=' || new.id)
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    display_name = EXCLUDED.display_name,
    email = EXCLUDED.email,
    avatar_url = EXCLUDED.avatar_url;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Safe trigger setup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 6. ENABLE REAL-TIME REPLICATION FOR ACTIVE SYNCING
-- This tells Supabase to broadcast insert/update/delete events on these tables safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'groups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'group_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- 7. SECURITY POLICY (RLS) HOOKS FOR MESSAGES SECURITY
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Dynamic Policies:
DROP POLICY IF EXISTS "Allow read profiles" ON public.profiles;
CREATE POLICY "Allow read profiles" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow personal update" ON public.profiles;
CREATE POLICY "Allow personal update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Allow personal insert" ON public.profiles;
CREATE POLICY "Allow personal insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Allow read groups" ON public.groups;
CREATE POLICY "Allow read groups" ON public.groups FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow create groups" ON public.groups;
CREATE POLICY "Allow create groups" ON public.groups FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow read members" ON public.group_members;
CREATE POLICY "Allow read members" ON public.group_members FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow join groups" ON public.group_members;
CREATE POLICY "Allow join groups" ON public.group_members FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow leave groups" ON public.group_members;
CREATE POLICY "Allow leave groups" ON public.group_members FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Only participants read messages" ON public.messages;
CREATE POLICY "Only participants read messages" ON public.messages FOR SELECT
  USING (
    auth.uid() = sender_id OR
    auth.uid() = receiver_id OR
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = messages.group_id AND group_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Send own messages" ON public.messages;
CREATE POLICY "Send own messages" ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "Allow message updates" ON public.messages;
CREATE POLICY "Allow message updates" ON public.messages FOR UPDATE
  USING (
    auth.uid() = sender_id OR
    auth.uid() = receiver_id OR
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = messages.group_id AND group_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = sender_id OR
    auth.uid() = receiver_id OR
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = messages.group_id AND group_members.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Allow update members" ON public.group_members;
CREATE POLICY "Allow update members" ON public.group_members FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 8. BACKFILL PRE-EXISTING USERS (If tables are setup after accounts are created)
INSERT INTO public.profiles (id, username, display_name, email, avatar_url)
SELECT 
  id, 
  LOWER(REGEXP_REPLACE(COALESCE(raw_user_meta_data->>'username', SPLIT_PART(email, '@', 1)), '[^a-zA-Z0-9_.]', '', 'g')),
  COALESCE(raw_user_meta_data->>'display_name', raw_user_meta_data->>'username', SPLIT_PART(email, '@', 1)),
  email,
  COALESCE(raw_user_meta_data->>'avatar_url', 'https://api.dicebear.com/7.x/adventurer/svg?seed=' || id)
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email;

-- 9. DEFENSIVE ALL-ACCESS GRANTS ON THE TABLES
-- This guarantees standard Supabase roles (anon, authenticated) can read/write the custom schemas
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.profiles TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.groups TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.group_members TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.messages TO postgres, anon, authenticated, service_role;

-- 10. COMPLETE CALLING SCHEMAS
CREATE TABLE IF NOT EXISTS public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
  status TEXT NOT NULL CHECK (status IN ('ringing', 'accepted', 'rejected', 'missed', 'busy', 'ended', 'declined', 'no_response', 'cancelled_by_caller')),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  ended_at TIMESTAMP WITH TIME ZONE,
  duration INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.call_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES public.calls(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
  status TEXT NOT NULL CHECK (status IN ('ringing', 'accepted', 'rejected', 'missed', 'busy', 'ended', 'declined', 'no_response', 'cancelled_by_caller')),
  duration INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for calling tables
CREATE INDEX IF NOT EXISTS idx_calls_caller_id ON public.calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_calls_receiver_id ON public.calls(receiver_id);
CREATE INDEX IF NOT EXISTS idx_call_signals_call_id ON public.call_signals(call_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_caller_id ON public.call_logs(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_receiver_id ON public.call_logs(receiver_id);

-- Enable Real-Time replication for calling tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'call_signals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_signals;
  END IF;
END $$;

-- Security Policies (RLS) for calling tables
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can access own calls" ON public.calls;
CREATE POLICY "Participants can access own calls" ON public.calls FOR ALL
  USING (auth.uid() = caller_id OR auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = caller_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Participants can access own signals" ON public.call_signals;
CREATE POLICY "Participants can access own signals" ON public.call_signals FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.calls
      WHERE calls.id = call_signals.call_id
        AND (calls.caller_id = auth.uid() OR calls.receiver_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calls
      WHERE calls.id = call_id
        AND (calls.caller_id = auth.uid() OR calls.receiver_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Participants can access own call logs" ON public.call_logs;
CREATE POLICY "Participants can access own call logs" ON public.call_logs FOR ALL
  USING (auth.uid() = caller_id OR auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = caller_id OR auth.uid() = receiver_id);

-- Grants
GRANT ALL ON public.calls TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.call_signals TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.call_logs TO postgres, anon, authenticated, service_role;

-- 11. PUSH TOKENS TABLE FOR CALLS NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.push_tokens (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
  token TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow user to manage own push token" ON public.push_tokens;
CREATE POLICY "Allow user to manage own push token" ON public.push_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Grants for push_tokens
GRANT ALL ON public.push_tokens TO postgres, anon, authenticated, service_role;

-- Enable Real-Time replication for push_tokens (optional but helpful)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'push_tokens'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.push_tokens;
  END IF;
END $$;

-- 12. GROUP CALL TABLES
CREATE TABLE IF NOT EXISTS public.call_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'ringing' CHECK (status IN ('ringing', 'active', 'ended')) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.call_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.call_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  left_at TIMESTAMP WITH TIME ZONE,
  is_muted BOOLEAN DEFAULT FALSE NOT NULL,
  camera_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  UNIQUE (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.group_call_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.call_rooms(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_call_rooms_group_id ON public.call_rooms(group_id);
CREATE INDEX IF NOT EXISTS idx_call_participants_room_id ON public.call_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_call_participants_user_id ON public.call_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_group_call_signals_room_id ON public.group_call_signals(room_id);

-- Enable RLS
ALTER TABLE public.call_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_call_signals ENABLE ROW LEVEL SECURITY;

-- Policies for call_rooms
DROP POLICY IF EXISTS "Any group member can manage call rooms" ON public.call_rooms;
CREATE POLICY "Any group member can manage call rooms" ON public.call_rooms FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = call_rooms.group_id AND group_members.user_id = auth.uid()
    )
  );

-- Policies for call_participants
DROP POLICY IF EXISTS "Any group member can manage participants" ON public.call_participants;
CREATE POLICY "Any group member can manage participants" ON public.call_participants FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.call_rooms r
      JOIN public.group_members m ON m.group_id = r.group_id
      WHERE r.id = call_participants.room_id AND m.user_id = auth.uid()
    )
  );

-- Policies for group_call_signals
DROP POLICY IF EXISTS "Participants can manage signals" ON public.group_call_signals;
CREATE POLICY "Participants can manage signals" ON public.group_call_signals FOR ALL
  USING (
    auth.uid() = sender_id OR auth.uid() = receiver_id
  );

-- Grants
GRANT ALL ON public.call_rooms TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.call_participants TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.group_call_signals TO postgres, anon, authenticated, service_role;

-- Enable Real-Time replication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'call_rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_rooms;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'call_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_participants;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'group_call_signals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_call_signals;
  END IF;
END $$;

-- 13. WALKIE-TALKIE ROOMS AND MEMBERS TABLES
CREATE TABLE IF NOT EXISTS public.walkie_talkie_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended')) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.walkie_talkie_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.walkie_talkie_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  left_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (room_id, user_id)
);

-- Indexes for Walkie-Talkie tables
CREATE INDEX IF NOT EXISTS idx_walkie_talkie_rooms_group_id ON public.walkie_talkie_rooms(group_id);
CREATE INDEX IF NOT EXISTS idx_walkie_talkie_members_room_id ON public.walkie_talkie_members(room_id);
CREATE INDEX IF NOT EXISTS idx_walkie_talkie_members_user_id ON public.walkie_talkie_members(user_id);

-- Enable RLS for Walkie-Talkie tables
ALTER TABLE public.walkie_talkie_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walkie_talkie_members ENABLE ROW LEVEL SECURITY;

-- Policies for walkie_talkie_rooms
DROP POLICY IF EXISTS "Any group member can manage walkie talkie rooms" ON public.walkie_talkie_rooms;
CREATE POLICY "Any group member can manage walkie talkie rooms" ON public.walkie_talkie_rooms FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_members.group_id = walkie_talkie_rooms.group_id AND group_members.user_id = auth.uid()
    )
  );

-- Policies for walkie_talkie_members
DROP POLICY IF EXISTS "Any group member can manage walkie talkie members" ON public.walkie_talkie_members;
CREATE POLICY "Any group member can manage walkie talkie members" ON public.walkie_talkie_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.walkie_talkie_rooms r
      JOIN public.group_members m ON m.group_id = r.group_id
      WHERE r.id = walkie_talkie_members.room_id AND m.user_id = auth.uid()
    )
  );

-- Grants
GRANT ALL ON public.walkie_talkie_rooms TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.walkie_talkie_members TO postgres, anon, authenticated, service_role;

-- Enable Real-Time replication for Walkie-Talkie tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'walkie_talkie_rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.walkie_talkie_rooms;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'walkie_talkie_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.walkie_talkie_members;
  END IF;
END $$;

-- 11. CREATE USER DEVICES TABLE (WHATSAPP-STYLE DEVICE VERIFICATION)
CREATE TABLE IF NOT EXISTS public.user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  device_id TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL,
  device_name TEXT NOT NULL,
  browser TEXT,
  browser_version TEXT,
  operating_system TEXT,
  platform TEXT,
  screen_resolution TEXT,
  timezone TEXT,
  language TEXT,
  public_key_fingerprint TEXT,
  login_time TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  login_count INT DEFAULT 1,
  is_primary BOOLEAN DEFAULT false,
  is_revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_user_device_id UNIQUE(user_id, device_id)
);

-- Add columns and fix constraints if table existed before
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_devices' AND column_name='is_primary') THEN
    ALTER TABLE public.user_devices ADD COLUMN is_primary BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_devices' AND column_name='is_revoked') THEN
    ALTER TABLE public.user_devices ADD COLUMN is_revoked BOOLEAN DEFAULT false;
  END IF;
END $$;

ALTER TABLE public.user_devices DROP CONSTRAINT IF EXISTS unique_user_device_fingerprint;

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_device_id ON public.user_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_fingerprint ON public.user_devices(device_fingerprint);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_primary_per_user ON public.user_devices (user_id) WHERE (is_primary = true AND is_revoked = false);

-- Enable RLS for user_devices
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own devices" ON public.user_devices;
CREATE POLICY "Users can view their own devices" ON public.user_devices
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own devices" ON public.user_devices;
CREATE POLICY "Users can insert their own devices" ON public.user_devices
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own devices" ON public.user_devices;
CREATE POLICY "Users can update their own devices" ON public.user_devices
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own devices" ON public.user_devices;
CREATE POLICY "Users can delete their own devices" ON public.user_devices
  FOR DELETE USING (auth.uid() = user_id);

GRANT ALL ON public.user_devices TO postgres, anon, authenticated, service_role;

-- 12. CREATE DEVICE LOGIN REQUESTS TABLE (PRIMARY DEVICE APPROVAL)
CREATE TABLE IF NOT EXISTS public.device_login_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  requester_device_id TEXT NOT NULL,
  requester_device_name TEXT NOT NULL,
  requester_browser TEXT,
  requester_os TEXT,
  requester_fingerprint TEXT NOT NULL,
  primary_device_id TEXT,
  qr_session_token TEXT,
  status TEXT DEFAULT 'pending' NOT NULL, -- 'pending', 'approved', 'declined', 'expired'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

ALTER TABLE public.device_login_requests ADD COLUMN IF NOT EXISTS primary_device_id TEXT;

CREATE INDEX IF NOT EXISTS idx_device_login_requests_user ON public.device_login_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_device_login_requests_status ON public.device_login_requests(status);

ALTER TABLE public.device_login_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view login requests" ON public.device_login_requests;
CREATE POLICY "Users can view login requests" ON public.device_login_requests
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create login requests" ON public.device_login_requests;
CREATE POLICY "Users can create login requests" ON public.device_login_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update login requests" ON public.device_login_requests;
CREATE POLICY "Users can update login requests" ON public.device_login_requests
  FOR UPDATE USING (auth.uid() = user_id);

GRANT ALL ON public.device_login_requests TO postgres, anon, authenticated, service_role;

-- 13. CREATE QR LINK SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.qr_link_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL, -- 'active', 'used', 'expired'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qr_link_sessions_token ON public.qr_link_sessions(token);

ALTER TABLE public.qr_link_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage QR sessions" ON public.qr_link_sessions;
CREATE POLICY "Users can manage QR sessions" ON public.qr_link_sessions
  FOR ALL USING (auth.uid() = user_id);

GRANT ALL ON public.qr_link_sessions TO postgres, anon, authenticated, service_role;

-- Enable Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'user_devices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_devices;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'device_login_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.device_login_requests;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'qr_link_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.qr_link_sessions;
  END IF;
END $$;

-- 14. PUSH SUBSCRIPTIONS TABLE FOR PWA WEB PUSH
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  device_id TEXT,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage own push subscriptions" ON public.push_subscriptions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT ALL ON public.push_subscriptions TO postgres, anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'push_subscriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.push_subscriptions;
  END IF;
END $$;

-- 15. WEB PUSH NOTIFICATION TRIGGERS & EDGE FUNCTIONS DISPATCHERS
DO $$
BEGIN
  -- Attempt to enable pg_net extension (Supabase HTTP extension)
  BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_net";
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS "net";
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_net or net extension is not installed on this PostgreSQL instance. You can configure Supabase Database Webhooks via Supabase Dashboard -> Database -> Webhooks.';
    END;
  END;
END $$;

-- Message Push Trigger Function (Safe check for net schema / functions)
CREATE OR REPLACE FUNCTION public.handle_message_push_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  supabase_url TEXT := current_setting('custom.supabase_url', true);
  service_role_key TEXT := current_setting('custom.service_role_key', true);
BEGIN
  IF supabase_url IS NULL OR supabase_url = '' THEN
    supabase_url := 'https://YOUR_SUPABASE_PROJECT_ID.supabase.co';
  END IF;

  -- Use net.http_post if net extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('pg_net', 'net')) THEN
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/send-message-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
      ),
      body := jsonb_build_object(
        'type', TG_OP,
        'record', row_to_json(NEW)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_message_web_push ON public.messages;
CREATE TRIGGER trigger_message_web_push
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_message_push_trigger();

-- Call Push Trigger Function
CREATE OR REPLACE FUNCTION public.handle_call_push_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  supabase_url TEXT := current_setting('custom.supabase_url', true);
  service_role_key TEXT := current_setting('custom.service_role_key', true);
BEGIN
  IF supabase_url IS NULL OR supabase_url = '' THEN
    supabase_url := 'https://YOUR_SUPABASE_PROJECT_ID.supabase.co';
  END IF;

  -- Execute HTTP POST via net extension if enabled
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('pg_net', 'net')) THEN
    -- Trigger send-call-push when status is initiated or ringing
    IF (NEW.status = 'ringing' OR NEW.status = 'initiated') THEN
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/send-call-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
        ),
        body := jsonb_build_object(
          'type', TG_OP,
          'record', row_to_json(NEW)
        )
      );
    ELSIF (NEW.status IN ('ended', 'rejected', 'cancelled')) THEN
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/send-call-ended-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
        ),
        body := jsonb_build_object(
          'type', TG_OP,
          'record', row_to_json(NEW)
        )
      );
    ELSIF (NEW.status = 'missed') THEN
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/send-missed-call-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
        ),
        body := jsonb_build_object(
          'type', TG_OP,
          'record', row_to_json(NEW)
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_call_web_push ON public.calls;
CREATE TRIGGER trigger_call_web_push
  AFTER INSERT OR UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_call_push_trigger();

-- Call Log (Missed Call) Push Trigger Function
CREATE OR REPLACE FUNCTION public.handle_call_log_push_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  supabase_url TEXT := current_setting('custom.supabase_url', true);
  service_role_key TEXT := current_setting('custom.service_role_key', true);
BEGIN
  IF supabase_url IS NULL OR supabase_url = '' THEN
    supabase_url := 'https://YOUR_SUPABASE_PROJECT_ID.supabase.co';
  END IF;

  IF (NEW.status = 'missed') THEN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('pg_net', 'net')) THEN
      PERFORM net.http_post(
        url := supabase_url || '/functions/v1/send-missed-call-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(service_role_key, '')
        ),
        body := jsonb_build_object(
          'type', TG_OP,
          'record', row_to_json(NEW)
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_call_log_web_push ON public.call_logs;
CREATE TRIGGER trigger_call_log_web_push
  AFTER INSERT ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_call_log_push_trigger();
`;
