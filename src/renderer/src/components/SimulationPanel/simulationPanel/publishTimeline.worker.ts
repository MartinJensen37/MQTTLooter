import { calculateTimeline, type TimelineInput } from './publishTimelineModel';

self.onmessage = (event: MessageEvent<TimelineInput>) => {
  try {
    self.postMessage({ result: calculateTimeline(event.data) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Could not calculate timeline',
    });
  }
};
