declare module 'react-router-bootstrap' {
  import type { ComponentType, ReactElement, CSSProperties } from 'react';
  import type { LinkProps } from 'react-router-dom';

  export interface LinkContainerProps extends Pick<LinkProps, 'to' | 'replace' | 'state'> {
    children: ReactElement;
    className?: string;
    isActive?: ((match: unknown, location: unknown) => boolean) | boolean;
    activeClassName?: string;
    activeStyle?: CSSProperties;
  }

  export const LinkContainer: ComponentType<LinkContainerProps>;
  export const IndexLinkContainer: ComponentType<LinkContainerProps>;
}
