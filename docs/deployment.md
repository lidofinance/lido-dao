## Steps

Some steps are skipped if already performed (e.g., obviously, ENS is already deployed to the mainnet).

- Deploy ENS
- Deploy APM aragonpm.eth
- Deploy code of the std aragon apps
- Publish the std aragon apps to the APM aragonpm.eth


- Deploy APM depoolspm.eth
- Deploy code of the depool apps, verify source
- Publish the depool apps to the APM depoolspm.eth


- Deploy code of the dao-template, verify source
    - deploy code of `DAOFactory`, `MiniMeTokenFactory`, verify source
- Publish dao-template to the APM depoolspm.eth


- Create a dao by running the dao-template.depoolspm.eth
