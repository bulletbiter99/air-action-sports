import { Helmet } from 'react-helmet-async';

export default function SEO({
  title,
  description,
  canonical,
  ogTitle,
  ogDescription,
  ogImage,
  ogUrl,
  ogType,
  twitterCard,
  children,
}) {
  const finalOgTitle = ogTitle || title;
  const finalOgDescription = ogDescription || description;
  const card = twitterCard || 'summary_large_image';

  return (
    <Helmet>
      {title && <title>{title}</title>}
      {description && <meta name="description" content={description} />}
      {canonical && <link rel="canonical" href={canonical} />}

      {/* Open Graph */}
      {finalOgTitle && <meta property="og:title" content={finalOgTitle} />}
      {finalOgDescription && <meta property="og:description" content={finalOgDescription} />}
      <meta property="og:type" content={ogType || 'website'} />
      {ogUrl && <meta property="og:url" content={ogUrl} />}
      {(canonical && !ogUrl) && <meta property="og:url" content={canonical} />}
      {ogImage && <meta property="og:image" content={ogImage} />}

      {/* Twitter Card — mirrors OG */}
      <meta name="twitter:card" content={card} />
      {finalOgTitle && <meta name="twitter:title" content={finalOgTitle} />}
      {finalOgDescription && <meta name="twitter:description" content={finalOgDescription} />}
      {ogImage && <meta name="twitter:image" content={ogImage} />}

      {children}
    </Helmet>
  );
}
