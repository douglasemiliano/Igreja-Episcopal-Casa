import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViewLecionarioComponent } from './view-lecionario.component';

describe('ViewLecionarioComponent', () => {
  let component: ViewLecionarioComponent;
  let fixture: ComponentFixture<ViewLecionarioComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViewLecionarioComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ViewLecionarioComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
