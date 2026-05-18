import React, { forwardRef } from 'react';
import { Button, Dropdown, ListGroup } from 'react-bootstrap';
import type { ButtonProps } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import type { LinkProps } from 'react-router-dom';

// react-bootstrap's polymorphic `as` prop is a generic that JSX often cannot
// infer through, so `<Button as={Link} to="...">` fails to type-check directly.
// Each wrapper below presents callers a precise public type (host props ∪ Link
// nav props). Internally we still pass `as={Link}` so react-router-dom's <Link>
// is what renders at runtime — the cast only hides the polymorphism limitation
// from the TS checker; runtime behavior is identical to the legacy LinkAs pattern.

type LinkBaseProps = Pick<LinkProps, 'to' | 'replace' | 'state'>;

// A single helper type alias documents what we're working around: the inner
// JSX needs `as={Link}` plus `to=`, and react-bootstrap's typing for these
// host components doesn't accept that shape via the polymorphic generic when
// invoked through JSX.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseAs = any;

// --- Button -----------------------------------------------------------------

export type LinkButtonProps = Omit<ButtonProps, 'as' | 'href'> & LinkBaseProps;

const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(
  ({ to, replace, state, ...rest }, ref) => {
    const AnyButton = Button as LooseAs;
    return (
      <AnyButton {...rest} ref={ref} as={Link} to={to} replace={replace} state={state} />
    );
  }
);
LinkButton.displayName = 'LinkButton';

export default LinkButton;

// --- Dropdown.Item ----------------------------------------------------------

type DropdownItemBaseProps = React.ComponentProps<typeof Dropdown.Item>;
export type LinkDropdownItemProps = Omit<DropdownItemBaseProps, 'as' | 'href'> & LinkBaseProps;

export const LinkDropdownItem = forwardRef<HTMLAnchorElement, LinkDropdownItemProps>(
  ({ to, replace, state, ...rest }, ref) => {
    const AnyDropdownItem = Dropdown.Item as LooseAs;
    return (
      <AnyDropdownItem {...rest} ref={ref} as={Link} to={to} replace={replace} state={state} />
    );
  }
);
LinkDropdownItem.displayName = 'LinkDropdownItem';

// --- ListGroup.Item ---------------------------------------------------------

type ListGroupItemBaseProps = React.ComponentProps<typeof ListGroup.Item>;
export type LinkListGroupItemProps = Omit<ListGroupItemBaseProps, 'as' | 'href'> & LinkBaseProps;

export const LinkListGroupItem = forwardRef<HTMLAnchorElement, LinkListGroupItemProps>(
  ({ to, replace, state, ...rest }, ref) => {
    const AnyListGroupItem = ListGroup.Item as LooseAs;
    return (
      <AnyListGroupItem {...rest} ref={ref} as={Link} to={to} replace={replace} state={state} />
    );
  }
);
LinkListGroupItem.displayName = 'LinkListGroupItem';
