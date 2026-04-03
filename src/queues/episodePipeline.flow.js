const { FlowProducer, Queue } = require('bullmq');
const { connection } = require('./connection');

const flowProducer = new FlowProducer({ connection });

const STAGE_NAMES = [
  'concept_extraction', 'script_generation', 'question_generation',
  'flashcard_generation', 'audio_generation', 'finalize',
];

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400 },   // 24h
  removeOnFail: { age: 604800 },      // 7d
};

/**
 * Phase 1: Start concept extraction as a standalone job.
 * When it completes, the worker calls dispatchParallelStages().
 */
async function createEpisodePipeline(episodeId) {
  const queue = new Queue('concept-extraction', { connection });
  const job = await queue.add('concept-extraction', { episodeId }, {
    ...DEFAULT_JOB_OPTS,
    jobId: `concept-${episodeId}`,
  });

  console.log(`[Pipeline] Started concept-extraction for episode ${episodeId}`);
  return job;
}

/**
 * Phase 2: Called by concept-extraction worker on success.
 * Dispatches script, questions, and flashcards in parallel.
 * Audio waits for script. Finalize waits for audio + questions + flashcards.
 *
 * Flow tree:
 *   finalize
 *     ├── audio-generation
 *     │     └── script-generation
 *     ├── question-generation
 *     └── flashcard-generation
 */
async function dispatchParallelStages(episodeId) {
  const flow = await flowProducer.add({
    name: 'finalize',
    queueName: 'finalize',
    data: { episodeId },
    opts: { ...DEFAULT_JOB_OPTS },
    children: [
      {
        name: 'audio-generation',
        queueName: 'audio-generation',
        data: { episodeId },
        opts: { ...DEFAULT_JOB_OPTS, attempts: 2 },
        children: [
          {
            name: 'script-generation',
            queueName: 'script-generation',
            data: { episodeId },
            opts: { ...DEFAULT_JOB_OPTS },
          },
        ],
      },
      {
        name: 'question-generation',
        queueName: 'question-generation',
        data: { episodeId },
        opts: { ...DEFAULT_JOB_OPTS },
      },
      {
        name: 'flashcard-generation',
        queueName: 'flashcard-generation',
        data: { episodeId },
        opts: { ...DEFAULT_JOB_OPTS },
      },
    ],
  });

  console.log(`[Pipeline] Dispatched parallel stages (script + questions + flashcards) for episode ${episodeId}`);
  return flow;
}

/**
 * Create a single-stage retry job (for retrying a failed stage).
 */
async function retrySingleStage(episodeId, stageName) {
  const queue = new Queue(stageName.replace(/_/g, '-'), { connection });

  const job = await queue.add(stageName, { episodeId }, {
    ...DEFAULT_JOB_OPTS,
    jobId: `retry-${stageName}-${episodeId}-${Date.now()}`,
  });

  console.log(`[Pipeline] Retrying stage ${stageName} for episode ${episodeId}, job ${job.id}`);
  return job;
}

module.exports = {
  flowProducer,
  createEpisodePipeline,
  dispatchParallelStages,
  retrySingleStage,
  STAGE_NAMES,
  DEFAULT_JOB_OPTS,
};
