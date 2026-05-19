import { NextRequest, NextResponse } from 'next/server';
import { GET as getStats } from './stats/route';

export async function GET(request: NextRequest) {
  return getStats(request);
}
