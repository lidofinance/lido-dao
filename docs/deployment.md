## Steps

Some steps are skipped if already performed (e.g., obviously, ENS is already deployed to the mainnet).

- Deploy ENS
- Deploy APM aragonpm.eth (see https://github.com/aragon/apm/tree/master/scripts)
- Deploy code of the std aragon apps (?)
- Publish the std aragon apps to the APM aragonpm.eth (?)


- Deploy APM lidopm.eth (see https://github.com/aragon/apm/tree/master/scripts)
- Deploy code of the lido apps, verify source (TODO: impl `deploy*` targets, example: https://github.com/AutarkLabs/open-enterprise/blob/dev/package.json)
- Publish the lido apps to the APM lidopm.eth (TODO: impl `publish*` targets, example: https://github.com/AutarkLabs/open-enterprise/blob/dev/package.json)


- Deploy code of the dao-template, verify source (TODO: impl `deploy*` targets, example: https://github.com/AutarkLabs/open-enterprise/blob/dev/templates/open-enterprise/package.json)
    - deploy code of `DAOFactory`, `MiniMeTokenFactory`, verify source
- Publish dao-template to the APM lidopm.eth (TODO: impl `publish*` targets, example: https://github.com/AutarkLabs/open-enterprise/blob/dev/templates/open-enterprise/package.json)


- Create a dao by running the dao-template.lidopm.eth (TODO: patch `../bin/deploy-dev-contracts.sh`)
