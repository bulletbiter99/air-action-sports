import { Helmet } from 'react-helmet-async';

export default function SEO({
  title,
  description,
  canonical,
  ogTitle,
  ogDescription,
  ogImage,
  ogUrl,
  children,
}) {
  return (
    <Helmet>
      {title && <title>{title}</title>}
      {description && <meta name="description" content={description} />}
      {canonical && <link rel="canonical" href={canonical} />}

      {/* Open Graph */}
      {(ogTitle || title) && (
        <meta property="og:title" content={ogTitle || title} />
      )}
      {(ogDescription || description) && (
        <meta property="og:description" content={ogDescription || description} />
      )}
      <meta property="og:type" content="website" />
      {ogUrl && <meta property="og:url" content={ogUrl} />}
      {ogImage && <meta property="og:image" content={ogImage} />}

      {children}
    </Helmet>
  );
}
