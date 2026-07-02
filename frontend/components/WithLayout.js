// components/WithLayout.js — HOC-style layout wrapper (PATTERN-SPEC §B3.4/§B4.2.5).
// Pages stay thin: they fetch data + set <Head>, then render a view inside a
// layout via this helper.
const WithLayout = ({ component: Component, layout: Layout, ...rest }) => (
  <Layout>
    <Component {...rest} />
  </Layout>
);

export default WithLayout;
