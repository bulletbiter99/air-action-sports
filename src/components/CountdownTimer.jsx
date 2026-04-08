import useCountdown from '../hooks/useCountdown';

export default function CountdownTimer({ targetDate }) {
  const { days, hours, mins, secs } = useCountdown(targetDate);

  return (
    <div className="countdown-timer">
      <div className="cd-block">
        <div className="cd-num">{days}</div>
        <div className="cd-unit">Days</div>
      </div>
      <div className="cd-sep">:</div>
      <div className="cd-block">
        <div className="cd-num">{hours}</div>
        <div className="cd-unit">Hours</div>
      </div>
      <div className="cd-sep">:</div>
      <div className="cd-block">
        <div className="cd-num">{mins}</div>
        <div className="cd-unit">Mins</div>
      </div>
      <div className="cd-sep">:</div>
      <div className="cd-block">
        <div className="cd-num">{secs}</div>
        <div className="cd-unit">Secs</div>
      </div>
    </div>
  );
}
