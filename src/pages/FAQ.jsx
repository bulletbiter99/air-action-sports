import { useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import { faqCategories } from '../data/faq';
import '../styles/pages/faq.css';

export default function FAQ() {
  return (
    <>
      <SEO
        title="FAQ — Air Action Sports"
        description="Frequently asked questions about Air Action Sports airsoft events. Everything you need to know before your first game."
        canonical="https://airactionsport.com/faq"
        ogImage="https://airactionsport.com/images/og-image.jpg"
      />

      <div className="page-content">
        <div className="section-label">&#9632; FAQ</div>
        <h1 className="section-title">Intel Briefing.</h1>
        <div className="divider"></div>
        <p className="section-sub">
          Everything you need to know before hitting the field. Can't find your answer? Get in touch and we'll brief you directly.
        </p>

        {faqCategories.map((category, catIndex) => (
          <FaqCategory
            key={catIndex}
            title={category.title}
            items={category.items}
            isFirst={catIndex === 0}
          />
        ))}
      </div>

      {/* CTA Band */}
      <div className="cta-band">
        <h2>Still Have Questions?</h2>
        <p>Get in touch and we'll brief you on everything you need to know.</p>
        <Link to="/contact" className="btn-white">&#9658; Contact Us</Link>
      </div>
    </>
  );
}

function FaqCategory({ title, items, isFirst }) {
  const [activeIndex, setActiveIndex] = useState(-1);

  const toggleItem = (index) => {
    setActiveIndex(activeIndex === index ? -1 : index);
  };

  return (
    <div className="faq-category" style={isFirst ? { marginTop: '3rem' } : undefined}>
      <div className="faq-category-title">{title}</div>
      {items.map((item, index) => (
        <div className={`faq-item ${activeIndex === index ? 'active' : ''}`} key={index}>
          <button className="faq-question" onClick={() => toggleItem(index)}>
            {item.question}
            <span className="faq-icon">+</span>
          </button>
          <div
            className="faq-answer"
            style={{
              maxHeight: activeIndex === index ? '500px' : '0',
            }}
          >
            <p>{item.answer}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
