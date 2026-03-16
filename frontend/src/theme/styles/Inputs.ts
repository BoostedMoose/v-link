import styled from 'styled-components';

interface LinkProps {
  isActive?: boolean;
  activeColor?: string;
  inactiveColor?: string;
}

export const Link = styled.button<LinkProps>`
    height: ${({ theme }) => theme.interaction.buttonHeight}px;
    width: 100%;

    color: ${({ theme, isActive, activeColor, inactiveColor }) => isActive ? activeColor : inactiveColor};
    font-size: ${({ theme }) => theme.typography.caption2.fontSize};

    display: flex;
    flex-direction: row;
    justify-content: left;
    align-items: center;

    gap: 10px;
    background: none;
    border: none;

    &:hover {
        cursor: pointer;
    }
`;

export const Button = styled.button`
    height: ${({ theme }) => theme.interaction.buttonHeight}px;
    width: 100%;

    color: ${({ theme }) => theme.colors.text};
    font-family: ${({ theme }) => theme.typography.button.fontFamily};
    font-weight: ${({ theme }) => theme.typography.button.fontWeight};
    font-size: ${({ theme }) => theme.typography.button.fontSize};

    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;

    gap: 10px;
    background-color: ${({ theme }) => theme.colors.button};;
    border: none;

    border-radius: 10px;

    &:hover {
        cursor: pointer;
        background-color: ${({ theme }) => theme.colors.background};
    }
`;

interface ToggleSwitchProps {
  backgroundColor?: string;
  defaultColor?: string;
  activeColor?: string;
}

export const ToggleSwitch = styled.label<ToggleSwitchProps>`
  position: relative;
  display: inline-block;
  width: 50px; /* Width of the toggle */
  height: ${({ theme }) => theme.interaction.toggleHeight}px};
  cursor: pointer;

  input {
    opacity: 0; /* Hide the checkbox input */
    width: 0;
    height: 0;
  }

  /* The background of the toggle */
  .slider {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: ${({ backgroundColor }) => backgroundColor}; /* Start as primary */
    border-radius: 10px;
    transition: background-color 0.2s ease;
  }

  /* The sliding circle inside the toggle */
  .slider:before {
    position: absolute;
    content: '';
    height: 16px;
    width: 16px;
    left: 3px;
    bottom: 2px;
    background-color: ${({ defaultColor }) => defaultColor}; /* Start as default */
    border-radius: 50%;
    transition: transform 0.2s ease, background-color 0.2s ease; /* Smooth transitions for position and color */
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  /* When the input is checked, update styles */
  input:checked + .slider {
    background-color: ${({ defaultColor }) => defaultColor}; /* Change to default */
  }

  input:checked + .slider:before {
    transform: translateX(28px); /* Move the circle to the right */
    background-color: ${({ activeColor }) => activeColor}; /* Change to active */
  }
`;

interface SelectProps {
  isActive?: boolean;
}

export const Select = styled.select<SelectProps>`
  font-size: ${({ theme }) => theme.typography.caption2.fontSize};
  height: ${({ theme }) => theme.interaction.buttonHeight}px;
  width: 100%;
  border-radius: 10px;
  text-align: center;
  text-decoration: none;
  display: inline-block;
  border: none;
  color: ${({ theme }) => theme.colors.text};
  background-color: ${({ isActive, theme }) => (isActive ? theme.colors.button : theme.colors.medium)};

    &:focus {
    outline: none;
    border-color:${({ theme }) => theme.colors.text};;
    background-color:${({ theme }) => theme.colors.dark};;
  }
`;

export const Input = styled.input`
    height: ${({ theme }) => theme.interaction.buttonHeight}px;
    width: 100%;
    font-size: ${({ theme }) => theme.typography.caption2.fontSize};
    text-align: center;
    text-decoration: none;
    display: inline-block;
    border: 0;
    border-radius: 10px;
    opacity: 1;
    color: ${({ theme }) => theme.colors.text};;
    background-color: ${({ theme }) => theme.colors.button};
`;
