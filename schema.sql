-- 1. Create students table
CREATE TABLE IF NOT EXISTS public.students (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_code TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS (Row Level Security)
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- Allow public select (for parent logins) and authenticated users read
CREATE POLICY "Allow public select on students" ON public.students FOR SELECT USING (true);
CREATE POLICY "Allow admin edit on students" ON public.students FOR ALL USING (true);

-- 2. Create topics table
CREATE TABLE IF NOT EXISTS public.topics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    guide TEXT,
    date TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on topics" ON public.topics FOR SELECT USING (true);
CREATE POLICY "Allow admin edit on topics" ON public.topics FOR ALL USING (true);

-- 3. Create works table
CREATE TABLE IF NOT EXISTS public.works (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_email TEXT REFERENCES public.students(email) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    topic_id TEXT REFERENCES public.topics(id) ON DELETE CASCADE,
    title TEXT,
    content TEXT,
    status TEXT NOT NULL DEFAULT '임시저장',
    feedback TEXT,
    star INTEGER DEFAULT 0,
    spelling_log TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;

-- Policies for works table
-- Allow students to read/write their own works based on email
CREATE POLICY "Allow students select their own works" ON public.works
    FOR SELECT USING (auth.jwt() ->> 'email' = student_email);

CREATE POLICY "Allow students insert their own works" ON public.works
    FOR INSERT WITH CHECK (auth.jwt() ->> 'email' = student_email);

CREATE POLICY "Allow students update their own works" ON public.works
    FOR UPDATE USING (auth.jwt() ->> 'email' = student_email);

-- Allow teacher/parent to select works
CREATE POLICY "Allow teacher and parent read all works" ON public.works
    FOR SELECT USING (true);

-- Allow teacher to insert/update reviews
CREATE POLICY "Allow teacher modify reviews" ON public.works
    FOR ALL USING (true);

-- Populate default mock data
INSERT INTO public.topics (id, title, guide, date) VALUES
('T001', '내가 가장 좋아하는 계절과 그 이유', '봄, 여름, 가을, 겨울 중 가장 마음에 드는 계절을 하나 고르고, 왜 그렇게 생각하는지 어울리는 자신의 경험이나 추억과 함께 구체적으로 써보세요.', '2026. 6. 10.'),
('T002', '나에게 하루 동안 초능력이 생긴다면?', '만약 단 하루 동안 무엇이든 할 수 있는 힘이 생긴다면 어떤 능력을 가지고 싶나요? 그 능력으로 하루를 어떻게 보낼지 자유롭고 창의적으로 서술해 봅시다.', '2026. 6. 17.')
ON CONFLICT (id) DO NOTHING;
