const { pgTable, uuid, text, varchar, integer, jsonb, timestamp, pgEnum, decimal } = require('drizzle-orm/pg-core');

// --- Enums ---
const pipelineStatusEnum = pgEnum('pipeline_status', [
  'pending', 'running', 'completed', 'failed', 'partial'
]);

const stageNameEnum = pgEnum('stage_name', [
  'concept_extraction', 'script_generation', 'question_generation',
  'flashcard_generation', 'audio_generation', 'finalize'
]);

const stageStatusEnum = pgEnum('stage_status', [
  'pending', 'running', 'completed', 'failed', 'skipped'
]);

const difficultyEnum = pgEnum('difficulty', ['easy', 'medium', 'hard']);

// --- Tables ---

const episodes = pgTable('episodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  gradeBand: varchar('grade_band', { length: 20 }).notNull().default('9-10'),
  durationMinutes: integer('duration_minutes').notNull().default(10),
  speaker1Name: varchar('speaker1_name', { length: 100 }).notNull().default('Alex'),
  speaker2Name: varchar('speaker2_name', { length: 100 }).notNull().default('Sam'),
  pdfFilename: varchar('pdf_filename', { length: 255 }),
  rawText: text('raw_text'),
  pipelineStatus: pipelineStatusEnum('pipeline_status').notNull().default('pending'),
  audioStorageKey: text('audio_storage_key'),
  audioUrl: text('audio_url'),
  audioDurationSec: integer('audio_duration_sec'),
  scriptJson: jsonb('script_json'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

const concepts = pgTable('concepts', {
  id: uuid('id').primaryKey().defaultRandom(),
  episodeId: uuid('episode_id').notNull().references(() => episodes.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  keyTerms: jsonb('key_terms'),
  orderIndex: integer('order_index').notNull().default(0),
  sourceText: text('source_text'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  episodeId: uuid('episode_id').notNull().references(() => episodes.id, { onDelete: 'cascade' }),
  conceptId: uuid('concept_id').references(() => concepts.id, { onDelete: 'set null' }),
  question: text('question').notNull(),
  options: jsonb('options').notNull(),
  correctIndex: integer('correct_index').notNull(),
  explanation: text('explanation'),
  difficulty: difficultyEnum('difficulty').notNull().default('medium'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

const flashcards = pgTable('flashcards', {
  id: uuid('id').primaryKey().defaultRandom(),
  episodeId: uuid('episode_id').notNull().references(() => episodes.id, { onDelete: 'cascade' }),
  conceptId: uuid('concept_id').references(() => concepts.id, { onDelete: 'set null' }),
  front: text('front').notNull(),
  back: text('back').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

const pipelineStages = pgTable('pipeline_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  episodeId: uuid('episode_id').notNull().references(() => episodes.id, { onDelete: 'cascade' }),
  stageName: stageNameEnum('stage_name').notNull(),
  status: stageStatusEnum('status').notNull().default('pending'),
  attempt: integer('attempt').notNull().default(0),
  error: text('error'),
  jobId: varchar('job_id', { length: 100 }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

module.exports = {
  pipelineStatusEnum,
  stageNameEnum,
  stageStatusEnum,
  difficultyEnum,
  episodes,
  concepts,
  questions,
  flashcards,
  pipelineStages,
};
