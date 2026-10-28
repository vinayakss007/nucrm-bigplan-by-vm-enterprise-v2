// fixture (#3280): Drizzle's builder form is the same read.
import { db } from '@/drizzle/db';
import { dealStages } from '@/drizzle/schema';

export const stages = () => db.select().from(dealStages);
