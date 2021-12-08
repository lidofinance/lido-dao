package contracts

import (
	"bytes"
	"fmt"
	"lido-cli/pkg/logs"
	"os/exec"

	"github.com/pterm/pterm"
)

type Contracts struct {
	Cmd  *exec.Cmd
	Outb bytes.Buffer
	Errb bytes.Buffer
}

func (node *Contracts) Start() error {
	s, _ := pterm.DefaultSpinner.Start("Contracs: compile...")

	node.Cmd = exec.Command("yarn", "compile")
	node.Cmd.Stdout = &node.Outb
	node.Cmd.Stderr = &node.Errb
	err := node.Cmd.Run()
	if err != nil {
		pterm.Error.Println(node.Errb.String())
		s.Fail()
		return err
	}

	//need to use different buffers
	if logs.Verbose {
		fmt.Print(node.Outb.String())
		node.Outb.Reset()
	}

	s.Success("Contracs: compile...done")
	return nil
}
