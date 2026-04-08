import { useState, useCallback } from 'react';

export default function useFormValidation(validationSchema) {
  const [values, setValues] = useState(() => {
    const initial = {};
    for (const key of Object.keys(validationSchema)) {
      initial[key] = '';
    }
    return initial;
  });
  const [errors, setErrors] = useState({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  const validate = useCallback(
    (fieldValues = values) => {
      const newErrors = {};
      for (const [field, rules] of Object.entries(validationSchema)) {
        const value = fieldValues[field];
        if (rules.required && (!value || (typeof value === 'string' && !value.trim()))) {
          newErrors[field] = rules.message || `${field} is required`;
        } else if (rules.pattern && value && !rules.pattern.test(value)) {
          newErrors[field] = rules.message || `${field} is invalid`;
        } else if (rules.minLength && value && value.length < rules.minLength) {
          newErrors[field] = rules.message || `${field} must be at least ${rules.minLength} characters`;
        } else if (rules.min && value && Number(value) < rules.min) {
          newErrors[field] = rules.message || `${field} must be at least ${rules.min}`;
        } else if (rules.validate && value) {
          const result = rules.validate(value);
          if (result) {
            newErrors[field] = result;
          }
        }
      }
      return newErrors;
    },
    [values, validationSchema]
  );

  const handleChange = useCallback(
    (e) => {
      const { name, value, type, checked } = e.target;
      const newValue = type === 'checkbox' ? checked : value;

      setValues((prev) => {
        const updated = { ...prev, [name]: newValue };
        if (isSubmitted) {
          const newErrors = validate(updated);
          setErrors(newErrors);
        }
        return updated;
      });
    },
    [isSubmitted, validate]
  );

  const handleSubmit = useCallback(
    (onSubmit) => (e) => {
      e.preventDefault();
      setIsSubmitted(true);
      const validationErrors = validate();
      setErrors(validationErrors);
      if (Object.keys(validationErrors).length === 0) {
        onSubmit(values);
      }
    },
    [values, validate]
  );

  const resetForm = useCallback(() => {
    const initial = {};
    for (const key of Object.keys(validationSchema)) {
      initial[key] = '';
    }
    setValues(initial);
    setErrors({});
    setIsSubmitted(false);
  }, [validationSchema]);

  return { values, errors, handleChange, handleSubmit, resetForm, isSubmitted };
}
