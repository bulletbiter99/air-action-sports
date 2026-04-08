import { useState } from 'react';

export default function FaqAccordion({ categories }) {
  const [openItem, setOpenItem] = useState(null);

  const toggleItem = (key) => {
    setOpenItem((prev) => (prev === key ? null : key));
  };

  return (
    <>
      {categories.map((category, catIdx) => (
        <div className="faq-category" key={catIdx} style={catIdx === 0 ? { marginTop: '3rem' } : undefined}>
          <div className="faq-category-title">{category.title}</div>
          {category.items.map((item, itemIdx) => {
            const key = `${catIdx}-${itemIdx}`;
            const isOpen = openItem === key;
            return (
              <div className={`faq-item${isOpen ? ' open' : ''}`} key={key}>
                <button
                  className="faq-question"
                  onClick={() => toggleItem(key)}
                  aria-expanded={isOpen}
                >
                  {item.question}
                  <span className={`faq-icon${isOpen ? ' open' : ''}`}>+</span>
                </button>
                <div
                  className="faq-answer"
                  style={{
                    maxHeight: isOpen ? '500px' : '0',
                    overflow: 'hidden',
                    transition: 'max-height 0.3s ease',
                  }}
                >
                  <p>{item.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
