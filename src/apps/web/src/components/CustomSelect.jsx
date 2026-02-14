import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function CustomSelect({
    value,
    options = [],
    placeholder = 'Select',
    disabled = false,
    onChange,
}) {
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef(null);
    const dropdownRef = useRef(null);
    const [dropdownStyle, setDropdownStyle] = useState({});

    const selectedLabel = useMemo(() => {
        const option = options.find((opt) => opt.value === value);
        return option ? option.label : placeholder;
    }, [options, placeholder, value]);

    function updateDropdownPosition() {
        if (!triggerRef.current || !isOpen) return;
        const rect = triggerRef.current.getBoundingClientRect();
        setDropdownStyle({
            position: 'fixed',
            top: `${rect.bottom + 8}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            zIndex: 9999,
        });
    }

    function toggleDropdown() {
        if (disabled) return;
        setIsOpen((prev) => !prev);
    }

    function selectOption(nextValue) {
        if (disabled) return;
        onChange?.(nextValue);
        setIsOpen(false);
    }

    useEffect(() => {
        if (!isOpen) return;
        updateDropdownPosition();
    }, [isOpen, options.length]);

    useEffect(() => {
        function handleClickOutside(e) {
            if (
                triggerRef.current?.contains(e.target) ||
                dropdownRef.current?.contains(e.target)
            ) {
                return;
            }
            setIsOpen(false);
        }

        function handleKeydown(e) {
            if (e.key === 'Escape') setIsOpen(false);
        }

        function handleScrollOrResize() {
            if (!isOpen) return;
            updateDropdownPosition();
        }

        function handleMouseMove(e) {
            if (!triggerRef.current) return;
            const rect = triggerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            triggerRef.current.style.setProperty('--mouse-x', `${x}px`);
            triggerRef.current.style.setProperty('--mouse-y', `${y}px`);
        }

        document.addEventListener('click', handleClickOutside);
        document.addEventListener('keydown', handleKeydown);
        document.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize);

        return () => {
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleKeydown);
            document.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [isOpen]);

    return (
        <div className={['custom-select', isOpen ? 'is-open' : ''].join(' ')}>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                className={['select-trigger input-glass', disabled ? 'opacity-60 cursor-not-allowed' : ''].join(' ')}
                onClick={toggleDropdown}
            >
                <span className="selected-value">{selectedLabel}</span>
                <svg
                    className={['dropdown-icon', isOpen ? 'rotate' : ''].join(' ')}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                >
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>

            {isOpen
                ? createPortal(
                      <div
                          ref={dropdownRef}
                          className="dropdown-menu"
                          style={dropdownStyle}
                      >
                          {options.map((option) => (
                              <div
                                  key={option.value}
                                  className={[
                                      'dropdown-item',
                                      option.value === value ? 'is-selected' : '',
                                  ].join(' ')}
                                  onClick={() => selectOption(option.value)}
                              >
                                  <span>{option.label}</span>
                                  {option.value === value ? (
                                      <i className="fas fa-check"></i>
                                  ) : null}
                              </div>
                          ))}
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}
