import { useEffect, useRef, useState } from 'react';

interface CountdownTimerProps {
  waitSeconds: number;
  onComplete?: () => void;
}

export function CountdownTimer({ waitSeconds, onComplete }: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(waitSeconds);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (waitSeconds <= 0) {
      onCompleteRef.current?.();
      return;
    }
    const endTime = Date.now() + waitSeconds * 1000;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.round((endTime - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(timer);
        onCompleteRef.current?.();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [waitSeconds]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const progress = waitSeconds > 0 ? ((waitSeconds - remaining) / waitSeconds) * 100 : 100;
  const isDone = remaining === 0;

  return (
    <div className="timer">
      <div className="timer__row">
        <span className="timer__label">
          {isDone ? 'Commit-reveal wait complete' : 'Waiting for commit-reveal period...'}
        </span>
        <span className={`timer__value ${isDone ? 'timer__value--done' : 'timer__value--active'}`}>
          {minutes}:{seconds.toString().padStart(2, '0')}
        </span>
      </div>
      <div className="timer__bar">
        <div
          className={`timer__fill ${isDone ? 'timer__fill--done' : 'timer__fill--active'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
