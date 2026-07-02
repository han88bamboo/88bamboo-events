// Main layout — the default site chrome (PATTERN-SPEC §B4.2.4). Nav + content +
// footer; intentionally minimal, same shape as Drink-X's Main.
import NavBar from './components/NavBar';
import FooterBar from './components/FooterBar';

const Main = ({ children }) => (
  <>
    <div>
      <NavBar />
    </div>
    <div>{children}</div>
    <div>
      <FooterBar />
    </div>
  </>
);

export default Main;
