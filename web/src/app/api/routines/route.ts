import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { getCachedRoutineTemplates } from '@/lib/cache';
import { createRoutineTemplate } from '@/features/routine/lib/queries';

export async function GET() {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await getCachedRoutineTemplates(userId);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: '루틴 조회 실패' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await requireAuth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await request.json()) as {
      name?: string;
      time_slot?: string | null;
      frequency?: string | null;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: '루틴 이름을 입력해줘' }, { status: 400 });
    }

    const data = await createRoutineTemplate(userId, {
      name: body.name.trim(),
      time_slot: body.time_slot ?? null,
      frequency: body.frequency ?? null,
    });

    revalidateTag('routines', 'seconds');
    return NextResponse.json({ data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '루틴 생성 실패' }, { status: 500 });
  }
}
