import {projectAssistantState} from './assistant-state.mjs';

// Keep questions and delivered files in the established student route. The
// preparation observation is read-only and never carries a working file.
export function studentPreparation(progress, durable, observation) {
 if (progress?.stage === 'needs_answer' || progress?.result) return null;
 if (progress?.route !== 'r3') return null;
 if (!progress.work) return {
  state: progress.lastReturn ? 'rework' : 'manual_work',
  label: progress.lastReturn ? 'Работа возвращена на доработку' :
   progress.stage === 'r3_in_work' ? 'Задание у исполнителя' : 'Задание получено',
  stale: observation?.connected === false, nextAction: null
 };
 return projectAssistantState({role:'student', work:progress.work, durable, observation});
}

// Testable owner/request fence: an old account's delayed reply must not repaint
// a newly opened account or another request, even if their local card IDs match.
export function sameStudentObservation(expected, current) {
 return !!expected.owner && expected.owner === current.owner &&
  expected.requestId === current.requestId;
}

if (typeof window !== 'undefined') {
 window.StudStudentAssistant = {studentPreparation, sameStudentObservation};
 window.dispatchEvent(new Event('student-assistant-ready'));
}
