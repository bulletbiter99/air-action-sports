export default function TestimonialCard({ testimonial }) {
  return (
    <div className="test-card">
      <div className="test-stars">
        {'★'.repeat(testimonial.stars || 5)}
      </div>
      <p className="test-text">&ldquo;{testimonial.text}&rdquo;</p>
      <div className="test-author">
        <div className="test-avatar">{testimonial.initials}</div>
        <div>
          <div className="test-name">{testimonial.name}</div>
          <div className="test-role">{testimonial.role}</div>
        </div>
      </div>
    </div>
  );
}
