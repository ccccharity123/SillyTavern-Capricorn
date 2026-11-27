export function node(parent, tag, className = '', text = '') {
  const element = parent.ownerDocument.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

export function button(parent, label, run, options = {}) {
  const element = node(parent, 'button', options.className || 'ct-button', label);
  element.type = 'button';
  element.disabled = Boolean(options.disabled);
  if (options.key) element.dataset.focusKey = options.key;
  element.addEventListener('click', event => {
    event.stopPropagation();
    run();
  });
  return element;
}
