-- 하위 카테고리: categories 자기 참조 FK
ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE;

-- 일정에 하위 카테고리 저장
ALTER TABLE schedules ADD COLUMN subcategory TEXT;

-- 유니크 제약 변경: 기존 (user_id, name) -> 부모별 유니크
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_user_name_unique;

-- 상위 카테고리: (user_id, name) 유니크 (parent_id IS NULL)
CREATE UNIQUE INDEX categories_parent_unique ON categories (user_id, name) WHERE parent_id IS NULL;

-- 하위 카테고리: (user_id, parent_id, name) 유니크
CREATE UNIQUE INDEX categories_child_unique ON categories (user_id, parent_id, name) WHERE parent_id IS NOT NULL;

-- 하위 카테고리 조회용 인덱스
CREATE INDEX idx_categories_parent_id ON categories (parent_id);
