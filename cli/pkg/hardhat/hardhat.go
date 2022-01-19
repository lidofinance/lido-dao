package hardhat

import (
	"bytes"
	"fmt"
	"lido-aragon/pkg/logs"
	"log"
	"os/exec"
	"strings"
	"time"

	"github.com/pterm/pterm"
)

type HardhatNode struct {
	Fork string
	Cmd  *exec.Cmd
}

func (node *HardhatNode) Start(infuraProjectUrl string) {
	if node.Cmd != nil && node.Cmd.Process != nil && node.Cmd.Process.Pid != 0 {
		fmt.Println("Hardhat already started")
		return
	}

	s, _ := pterm.DefaultSpinner.Start("Hardhat node: Starting...")

	var outb, errb bytes.Buffer

	if infuraProjectUrl == "" {
		node.Cmd = exec.Command("npx", "hardhat", "node")
	} else {
		//node.Cmd = exec.Command("/bin/sh", "-c", "cmd1; cmd2")
		node.Cmd = exec.Command("npx", "hardhat", "node", "--fork", infuraProjectUrl)
	}

	node.Cmd.Stdout = &outb //os.Stdout
	node.Cmd.Stderr = &errb //os.Stderr
	err := node.Cmd.Start()
	if err != nil {
		log.Panic(err)
	}

	for {
		if logs.Verbose {
			fmt.Print(outb.String())
		}

		if strings.Contains(outb.String(), "Accounts") {
			s.Success("Hardhat node: Started")
			break
		}

		if strings.Contains(errb.String(), "Error:") {
			s.Fail()
			pterm.Error.Println(errb.String())
			break
		}
		outb.Reset()
		time.Sleep(100 * time.Millisecond)
	}
}

func (node *HardhatNode) Stop() {
	if node.Cmd == nil {
		return
	}

	s, _ := pterm.DefaultSpinner.Start("Hardhat node: Stopping...")
	node.Cmd.Process.Kill()
	node.Cmd = nil

	s.Success("Hardhat node: Stopped")
}
