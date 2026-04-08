export default function FormGroup({
  label,
  id,
  type = 'text',
  placeholder,
  required,
  options,
  error,
  value,
  onChange,
  children,
  ...rest
}) {
  const hasError = !!error;

  const renderInput = () => {
    if (type === 'select') {
      return (
        <select
          id={id}
          name={id}
          className={`form-select${hasError ? ' error' : ''}`}
          required={required}
          value={value}
          onChange={onChange}
          {...rest}
        >
          {options?.map((opt, i) => (
            <option key={i} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    if (type === 'textarea') {
      return (
        <textarea
          id={id}
          name={id}
          className={`form-textarea${hasError ? ' error' : ''}`}
          placeholder={placeholder}
          required={required}
          value={value}
          onChange={onChange}
          {...rest}
        />
      );
    }

    if (type === 'radio' || type === 'checkbox') {
      return (
        <div className="form-options">
          {options?.map((opt, i) => (
            <label key={i} className="form-option-label">
              <input
                type={type}
                name={id}
                value={opt.value}
                checked={type === 'checkbox' ? value?.includes(opt.value) : value === opt.value}
                onChange={onChange}
                {...rest}
              />
              {opt.label}
            </label>
          ))}
        </div>
      );
    }

    return (
      <input
        type={type}
        id={id}
        name={id}
        className={`form-input${hasError ? ' error' : ''}`}
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={onChange}
        {...rest}
      />
    );
  };

  return (
    <div className={`form-group${hasError ? ' has-error' : ''}`}>
      {label && (
        <label className="form-label" htmlFor={id}>
          {label}
        </label>
      )}
      {renderInput()}
      {children}
      {hasError && <span className="form-error">{error}</span>}
    </div>
  );
}
