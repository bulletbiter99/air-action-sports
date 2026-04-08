export default function GameCard({ number, title, description, tags }) {
  return (
    <div className="game-card">
      <div className="game-num">{number}</div>
      <div className="game-title">{title}</div>
      <p className="game-desc">{description}</p>
      <div className="game-tags">
        {tags.map((tag, i) => (
          <span className="tag" key={i}>{tag}</span>
        ))}
      </div>
    </div>
  );
}
