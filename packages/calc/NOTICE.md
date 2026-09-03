# Third-Party Notices for @bendyline/squisq-calc

This notice applies to the `@bendyline/squisq-calc` npm package.
Squisq-authored code is licensed under the MIT license in `LICENSE`.
Third-party components remain under their respective license terms.

## Runtime and peer dependencies

| Package                 | Version | License        | Repository                           |
| ----------------------- | ------- | -------------- | ------------------------------------ |
| @ironcalc/wasm _(peer)_ | ^0.8.4  | MIT/Apache-2.0 | https://github.com/ironcalc/IronCalc |

The IronCalc wasm backend is an optional peer dependency, reached only through
the `@bendyline/squisq-calc/ironcalc` subpath via dynamic import. It is not
bundled, and consumers who never construct an IronCalc engine do not install
it. Copyright and complete license texts for the listed dependencies are
included in their respective npm distributions and source repositories.
